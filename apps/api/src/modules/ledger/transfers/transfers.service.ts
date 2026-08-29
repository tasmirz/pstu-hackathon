import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { canonical, sha256, SelfTransfer, withTransaction } from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../../../common/idempotency.util';
import { requireStepUp } from '../../../common/step-up.util';
import { UsersRepository } from '../core/users.repository';
import { LEDGER_WRITER_PORT, LedgerWriterPort } from '../core/ledger-writer.port';

export interface TransferParams {
  senderId: number;
  toPhone: string;
  amountPaisa: number;
  note?: string;
  idemKey: string;
  stepUpToken?: string;
}

/**
 * The P2P entry point. Everything specific to "a plain transfer" (self-
 * transfer, first-ever-recipient step-up, idempotency) lives here; the
 * actual money movement is `LedgerWriterPort.moveMoney`, shared with
 * bill-share settlement and money-request settlement.
 *
 * NOTE: the >৳5,000 HOLD/undo-window path (PLAN.md §4.2) is not implemented
 * yet — every transfer here goes straight to COMPLETED (see BUILD_LOG_CLAUDE.md).
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    @Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort,
    private readonly users: UsersRepository,
  ) {}

  async transfer(params: TransferParams) {
    const { senderId, toPhone, amountPaisa, note, idemKey, stepUpToken } = params;

    // Resolving the receiver happens outside the transaction — a plain read,
    // and doing it first lets USER_NOT_FOUND/SELF_TRANSFER fail before we
    // ever touch the idempotency table.
    const receiver = await this.users.findByPhone(toPhone);
    if (receiver.id === senderId) throw new SelfTransfer();

    const reqHash = sha256(canonical({ senderId, toPhone, amountPaisa }));

    return withTransaction(this.pool, async (t) => {
      const claim = await claimIdempotencyKey(t, senderId, idemKey, reqHash);
      if (!claim.isNew) return claim.response;

      // First-ever-recipient step-up is a ledger fact the gateway/controller
      // layer doesn't hold, so it's evaluated here (API.md "Step-up authentication").
      const priorTxn = await t.query(
        `SELECT 1 FROM ledger.transactions
          WHERE sender_id = $1 AND receiver_id = $2 AND state = 'COMPLETED' LIMIT 1`,
        [senderId, receiver.id],
      );
      if (priorTxn.rowCount === 0) {
        requireStepUp({ userId: senderId, token: stepUpToken, reason: 'FIRST_TIME_RECIPIENT', always: true });
      }
      requireStepUp({ userId: senderId, token: stepUpToken, reason: 'AMOUNT_THRESHOLD', amountPaisa });

      const response = await this.ledgerWriter.moveMoney(t, {
        senderId,
        receiverId: receiver.id,
        amountPaisa,
        kind: 'TRANSFER',
        note,
      });

      await storeIdempotencyResponse(t, senderId, idemKey, response);
      return response;
    });
  }
}
