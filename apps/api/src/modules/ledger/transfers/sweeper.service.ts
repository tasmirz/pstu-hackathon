import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { withTransaction } from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { config } from '../../../config';
import { AccountsRepository } from '../core/accounts.repository';
import { LEDGER_WRITER_PORT, LedgerWriterPort } from '../core/ledger-writer.port';

@Injectable()
export class SweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private isSweeping = false;

  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    @Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort,
    private readonly accounts: AccountsRepository,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        this.logger.error(`Error in sweeper background loop: ${err.message}`, err.stack);
      });
    }, config.sweeperIntervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<number> {
    if (this.isSweeping) return 0;
    this.isSweeping = true;
    try {
      return await this.sweepOnce();
    } finally {
      this.isSweeping = false;
    }
  }

  async sweepOnce(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id FROM ledger.transactions
       WHERE state = 'HELD' AND settle_after <= now()
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 100`,
    );

    let settledCount = 0;
    for (const r of rows) {
      try {
        const settled = await this.settleHeldTxn(r.id);
        if (settled) settledCount++;
      } catch (err: any) {
        this.logger.error(`Failed to settle held transaction ${r.id}: ${err.message}`, err.stack);
      }
    }
    return settledCount;
  }

  private async settleHeldTxn(txnId: number): Promise<boolean> {
    return withTransaction(this.pool, async (t) => {
      const check = await t.query(`SELECT * FROM ledger.transactions WHERE id = $1 FOR UPDATE`, [txnId]);
      const txn = check.rows[0];
      if (!txn || txn.state !== 'HELD') return false;

      const cas = await t.query(
        `UPDATE ledger.transactions SET state = 'COMPLETED' WHERE id = $1 AND state = 'HELD' RETURNING *`,
        [txnId],
      );
      if (!cas.rowCount) return false;

      const holdAccountId = await this.accounts.getOrCreateHoldAccountId(t, txn.sender_id);
      const receiverAccountId = await this.accounts.getUserAccountId(t, txn.receiver_id);

      await this.ledgerWriter.moveMoney(t, {
        senderId: txn.sender_id,
        receiverId: txn.receiver_id,
        amountPaisa: txn.amount,
        kind: 'HOLD_SETTLE',
        parentTxnId: txn.id,
        senderAccountId: holdAccountId,
        receiverAccountId: receiverAccountId,
        skipDailyLimitCheck: true,
        note: txn.note ? `Settle: ${txn.note}` : `Settle of ${txn.ref}`,
        outboxTopic: 'txn.completed',
      });

      return true;
    });
  }
}
