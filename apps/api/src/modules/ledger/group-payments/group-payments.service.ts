import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  AppError,
  canonical,
  InsufficientFunds,
  SelfTransfer,
  sha256,
  ValidationError,
  withTransaction,
} from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../../../common/idempotency.util';
import { requireStepUp } from '../../../common/step-up.util';
import { AccountsRepository } from '../core/accounts.repository';
import { UsersRepository } from '../core/users.repository';
import { LEDGER_WRITER_PORT, LedgerWriterPort } from '../core/ledger-writer.port';

export interface GroupItemInput {
  phone: string;
  amount_paisa: number;
}

export interface CreateGroupTransferParams {
  senderId: number;
  title?: string;
  items: GroupItemInput[];
  idemKey?: string;
  stepUpToken?: string;
}

@Injectable()
export class GroupPaymentsService {
  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    @Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort,
    private readonly accounts: AccountsRepository,
    private readonly users: UsersRepository,
  ) {}

  async create(params: CreateGroupTransferParams) {
    const { senderId, title, items, idemKey, stepUpToken } = params;

    if (!items || items.length < 2) {
      throw new ValidationError('A group transfer must have at least 2 recipients');
    }

    for (const item of items) {
      if (!item.amount_paisa || item.amount_paisa <= 0) {
        throw new ValidationError('Every group transfer item must have a positive amount');
      }
    }

    const phones = items.map((i) => i.phone);
    if (new Set(phones).size !== phones.length) {
      throw new ValidationError('Duplicate phone numbers in group transfer items');
    }

    const totalAmountPaisa = items.reduce((acc, i) => acc + i.amount_paisa, 0);

    const reqHash = idemKey ? sha256(canonical({ senderId, title, items, totalAmountPaisa })) : undefined;

    return withTransaction(this.pool, async (t) => {
      if (idemKey && reqHash) {
        const claim = await claimIdempotencyKey(t, senderId, idemKey, reqHash);
        if (!claim.isNew) return claim.response;
      }

      // Lock sender account
      const userAccountId = await this.accounts.getUserAccountId(t, senderId);
      const lockedSender = await t.query(
        `SELECT id, balance FROM ledger.accounts WHERE id = $1 FOR UPDATE`,
        [userAccountId],
      );
      const senderBalance = lockedSender.rows[0]?.balance ?? 0;

      // Check for dispute holds
      const disputeHoldRes = await t.query(
        `SELECT COALESCE(SUM(d.secured_amount), 0) AS dispute_holds
         FROM ledger.disputes d
         JOIN ledger.transactions t ON t.id = d.txn_id
         WHERE t.receiver_id = $1 AND d.state = 'OPEN'`,
        [senderId],
      );
      const disputeHolds = parseInt(disputeHoldRes.rows[0]?.dispute_holds ?? '0', 10);
      const availableBalance = Math.max(0, senderBalance - disputeHolds);

      if (availableBalance < totalAmountPaisa) {
        throw new InsufficientFunds(availableBalance, totalAmountPaisa);
      }

      // Step-up verification if applicable
      requireStepUp({ userId: senderId, token: stepUpToken, reason: 'AMOUNT_THRESHOLD', amountPaisa: totalAmountPaisa });

      // All-or-nothing reservation (GP-03): move full total from sender USER account into HOLD account with entries
      const holdAccountId = await this.accounts.getOrCreateHoldAccountId(t, senderId);
      const holdTxn = await this.ledgerWriter.moveMoney(t, {
        senderId,
        receiverId: senderId,
        amountPaisa: totalAmountPaisa,
        kind: 'TRANSFER',
        state: 'HELD',
        senderAccountId: userAccountId,
        receiverAccountId: holdAccountId,
        skipDailyLimitCheck: true,
        note: title ?? 'Group transfer reservation',
        outboxTopic: 'txn.held',
      });

      const batchRes = await t.query(
        `INSERT INTO ledger.group_batches (sender_id, total_amount_paisa, item_count, title, state)
         VALUES ($1, $2, $3, $4, 'PROCESSING')
         RETURNING id, sender_id, total_amount_paisa, item_count, title, state, created_at`,
        [senderId, totalAmountPaisa, items.length, title ?? 'Group transfer'],
      );
      const batch = batchRes.rows[0];

      const processedItems: any[] = [];
      let successCount = 0;
      let refundCount = 0;

      for (const item of items) {
        let receiver: any = null;
        try {
          receiver = await this.users.findByPhone(item.phone, t);
        } catch {
          receiver = null;
        }

        if (receiver && receiver.id === senderId) {
          throw new SelfTransfer();
        }

        if (receiver && receiver.status !== 'FROZEN') {
          // Pay from sender's HOLD account to receiver's USER account
          const receiverAccountId = await this.accounts.getUserAccountId(t, receiver.id);
          const moveRes = await this.ledgerWriter.moveMoney(t, {
            senderId,
            receiverId: receiver.id,
            amountPaisa: item.amount_paisa,
            kind: 'TRANSFER',
            parentTxnId: holdTxn.transaction.id,
            note: title ?? `Group payment to ${receiver.name}`,
            senderAccountId: holdAccountId,
            receiverAccountId,
            skipDailyLimitCheck: true,
          });

          const itemRes = await t.query(
            `INSERT INTO ledger.group_batch_items (batch_id, receiver_id, amount_paisa, state, txn_id)
             VALUES ($1, $2, $3, 'COMPLETED', $4)
             RETURNING id, batch_id, receiver_id, amount_paisa, state, txn_id, created_at`,
            [batch.id, receiver.id, item.amount_paisa, moveRes.transaction.id],
          );
          processedItems.push({
            ...itemRes.rows[0],
            receiver: { id: receiver.id, name: receiver.name, phone: receiver.phone },
          });
          successCount++;
        } else {
          // Invalid or frozen receiver -> refund this item back from sender HOLD account to sender USER account
          const refundRes = await this.ledgerWriter.moveMoney(t, {
            senderId,
            receiverId: senderId,
            amountPaisa: item.amount_paisa,
            kind: 'HOLD_CANCEL',
            parentTxnId: holdTxn.transaction.id,
            senderAccountId: holdAccountId,
            receiverAccountId: userAccountId,
            skipDailyLimitCheck: true,
            note: `Group payment refund for ${item.phone}`,
            outboxTopic: 'txn.held_cancelled',
          });

          const dummyReceiverId = receiver?.id ?? 0;
          const itemRes = await t.query(
            `INSERT INTO ledger.group_batch_items (batch_id, receiver_id, amount_paisa, state, error_reason)
             VALUES ($1, $2, $3, 'REFUNDED', $4)
             RETURNING id, batch_id, receiver_id, amount_paisa, state, error_reason, created_at`,
            [batch.id, dummyReceiverId, item.amount_paisa, 'Receiver invalid or account frozen'],
          );
          processedItems.push({
            ...itemRes.rows[0],
            phone: item.phone,
          });
          refundCount++;
        }
      }

      let finalState = 'COMPLETED';
      if (refundCount > 0 && successCount > 0) {
        finalState = 'PARTIALLY_COMPLETED';
      } else if (refundCount > 0 && successCount === 0) {
        finalState = 'FAILED';
      }

      await t.query(`UPDATE ledger.group_batches SET state = $1 WHERE id = $2`, [finalState, batch.id]);

      const finalSenderBalance = await this.accounts.getBalance(t, userAccountId);

      const response = {
        batch: {
          id: batch.id,
          title: batch.title,
          total_amount_paisa: batch.total_amount_paisa,
          item_count: batch.item_count,
          state: finalState,
          success_count: successCount,
          refund_count: refundCount,
          created_at: batch.created_at,
        },
        items: processedItems,
        balance_paisa: finalSenderBalance,
      };

      if (idemKey) {
        await storeIdempotencyResponse(t, senderId, idemKey, response);
      }

      return response;
    });
  }

  async listMine(userId: number, cursor?: number, limit = 20) {
    const limitPlusOne = limit + 1;
    const { rows } = await this.pool.query(
      `SELECT * FROM ledger.group_batches
       WHERE sender_id = $1
         AND ($2::bigint IS NULL OR id < $2::bigint)
       ORDER BY id DESC
       LIMIT $3`,
      [userId, cursor ?? null, limitPlusOne],
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageRows,
      next_cursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      has_more: hasMore,
    };
  }

  async getById(userId: number, batchId: number) {
    const batchRes = await this.pool.query(
      `SELECT * FROM ledger.group_batches WHERE id = $1`,
      [batchId],
    );
    const batch = batchRes.rows[0];
    if (!batch) throw new AppError(404, 'NOT_FOUND', 'Group batch not found');

    const itemsRes = await this.pool.query(
      `SELECT i.*, u.name AS receiver_name, u.phone AS receiver_phone
       FROM ledger.group_batch_items i
       LEFT JOIN auth.users_public u ON u.id = i.receiver_id
       WHERE i.batch_id = $1
       ORDER BY i.id ASC`,
      [batchId],
    );

    return {
      batch,
      items: itemsRes.rows,
    };
  }
}
