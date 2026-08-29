import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  canonical,
  InvalidState,
  NotAParty,
  SelfTransfer,
  sha256,
  TxnNotFound,
  withTransaction,
} from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../../../common/idempotency.util';
import { requireStepUp } from '../../../common/step-up.util';
import { config } from '../../../config';
import { AccountsRepository } from '../core/accounts.repository';
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

export interface CancelTransferParams {
  senderId: number;
  txnId: number;
  idemKey: string;
}

@Injectable()
export class TransfersService {
  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    @Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort,
    private readonly accounts: AccountsRepository,
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

      // Recipient reputation check: if below threshold, step-up is required regardless of amount
      const repRes = await t.query(
        `SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`,
        [receiver.id],
      );
      const receiverScore = repRes.rows[0]?.reputation_score ?? 50;
      if (receiverScore < config.reputationStepUpThreshold) {
        requireStepUp({ userId: senderId, token: stepUpToken, reason: 'LOW_REPUTATION_RECIPIENT', always: true });
      }

      // Threshold check: if above undo threshold, money moves into sender's HOLD account
      if (amountPaisa > config.undoThresholdPaisa) {
        const settleAfter = new Date(Date.now() + config.undoWindowSeconds * 1000);
        const holdAccountId = await this.accounts.getOrCreateHoldAccountId(t, senderId);

        const moveResult = await this.ledgerWriter.moveMoney(t, {
          senderId,
          receiverId: receiver.id,
          amountPaisa,
          kind: 'TRANSFER',
          state: 'HELD',
          settleAfter,
          receiverAccountId: holdAccountId,
          outboxTopic: 'txn.held',
          note,
        });

        const response = {
          transaction: {
            id: moveResult.transaction.id,
            ref: moveResult.transaction.ref,
            kind: moveResult.transaction.kind,
            state: moveResult.transaction.state,
            amount_paisa: moveResult.transaction.amount_paisa,
            note: moveResult.transaction.note,
            counterparty: moveResult.transaction.counterparty,
            settle_after: moveResult.transaction.settle_after,
            created_at: moveResult.transaction.created_at,
          },
          balance_paisa: moveResult.balance_paisa,
          can_cancel_until: settleAfter.toISOString(),
        };

        await storeIdempotencyResponse(t, senderId, idemKey, response);
        return response;
      }

      // Normal immediate COMPLETED transfer
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

  async cancel(params: CancelTransferParams) {
    const { senderId, txnId, idemKey } = params;

    const reqHash = sha256(canonical({ senderId, txnId }));

    return withTransaction(this.pool, async (t) => {
      const claim = await claimIdempotencyKey(t, senderId, idemKey, reqHash);
      if (!claim.isNew) return claim.response;

      const check = await t.query(`SELECT * FROM ledger.transactions WHERE id = $1 FOR UPDATE`, [txnId]);
      const txn = check.rows[0];
      if (!txn) throw new TxnNotFound();

      if (txn.sender_id !== senderId) throw new NotAParty();
      if (txn.state !== 'HELD') {
        throw new InvalidState('This transaction is not in HELD state');
      }
      if (new Date(txn.settle_after).getTime() <= Date.now()) {
        throw new InvalidState('The undo window for this transaction has expired');
      }

      const cas = await t.query(
        `UPDATE ledger.transactions SET state = 'CANCELLED' WHERE id = $1 AND state = 'HELD' RETURNING *`,
        [txnId],
      );
      if (!cas.rowCount) {
        throw new InvalidState('This transaction has already been settled or cancelled');
      }

      const holdAccountId = await this.accounts.getOrCreateHoldAccountId(t, senderId);
      const userAccountId = await this.accounts.getUserAccountId(t, senderId);

      const moveResult = await this.ledgerWriter.moveMoney(t, {
        senderId,
        receiverId: senderId,
        amountPaisa: txn.amount,
        kind: 'HOLD_CANCEL',
        parentTxnId: txn.id,
        senderAccountId: holdAccountId,
        receiverAccountId: userAccountId,
        skipDailyLimitCheck: true,
        note: `Cancel of ${txn.ref}`,
        outboxTopic: 'txn.held_cancelled',
      });

      const response = {
        transaction: moveResult.transaction,
        balance_paisa: moveResult.balance_paisa,
      };

      await storeIdempotencyResponse(t, senderId, idemKey, response);
      return response;
    });
  }
}
