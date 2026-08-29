import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  AppError,
  canonical,
  DisputeAlreadyOpen,
  DisputeWindowClosed,
  InvalidState,
  NotAParty,
  sha256,
  TxnNotFound,
  withTransaction,
} from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../../../common/idempotency.util';
import { requireStepUp } from '../../../common/step-up.util';
import { config } from '../../../config';
import { ReversalCoreService } from '../core/reversal-core.service';

export interface ResolveDisputeParams {
  adminId: number;
  disputeId: number;
  action: 'REVERSE' | 'REJECT';
  resolution: string;
  idemKey: string;
  stepUpToken?: string;
}

@Injectable()
export class DisputesService {
  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    private readonly reversalCore: ReversalCoreService,
  ) {}

  async raise(userId: number, txnId: number, reason: string) {
    const txnRes = await this.pool.query(
      `SELECT id, sender_id, receiver_id, created_at FROM ledger.transactions WHERE id = $1`,
      [txnId],
    );
    const txn = txnRes.rows[0];
    if (!txn) throw new TxnNotFound();

    if (txn.sender_id !== userId && txn.receiver_id !== userId) {
      throw new NotAParty();
    }

    const ageMs = Date.now() - new Date(txn.created_at).getTime();
    if (ageMs > config.disputeWindowDays * 24 * 60 * 60 * 1000) {
      throw new DisputeWindowClosed();
    }

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO ledger.disputes (txn_id, raised_by, reason, state)
         VALUES ($1, $2, $3, 'OPEN')
         RETURNING id, txn_id, state, created_at`,
        [txnId, userId, reason],
      );
      return rows[0];
    } catch (err: any) {
      if (err.code === '23505') {
        throw new DisputeAlreadyOpen();
      }
      throw err;
    }
  }

  async listMine(userId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, txn_id, reason, state, resolution, created_at, resolved_at
       FROM ledger.disputes
       WHERE raised_by = $1
       ORDER BY id DESC`,
      [userId],
    );
    return { items: rows };
  }

  async listQueue(state = 'OPEN', cursor?: number, limit = 20) {
    const limitPlusOne = limit + 1;
    const { rows } = await this.pool.query(
      `SELECT
         d.id, d.state, d.reason, d.raised_by, d.attempts, d.last_attempt_error, d.created_at,
         t.id AS txn_id, t.ref AS txn_ref, t.amount AS txn_amount, t.state AS txn_state, t.created_at AS txn_created_at,
         t.sender_id, t.receiver_id,
         u_sender.name AS sender_name, u_sender.phone AS sender_phone,
         u_receiver.name AS receiver_name, u_receiver.phone AS receiver_phone,
         acc_receiver.balance AS receiver_balance
       FROM ledger.disputes d
       JOIN ledger.transactions t ON t.id = d.txn_id
       LEFT JOIN auth.users_public u_sender ON u_sender.id = t.sender_id
       LEFT JOIN auth.users_public u_receiver ON u_receiver.id = t.receiver_id
       LEFT JOIN ledger.accounts acc_receiver ON acc_receiver.user_id = t.receiver_id AND acc_receiver.type = 'USER'
       WHERE d.state = $1
         AND ($2::bigint IS NULL OR d.id < $2::bigint)
       ORDER BY d.id DESC
       LIMIT $3`,
      [state, cursor ?? null, limitPlusOne],
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items = pageRows.map((r) => {
      const isSenderRaiser = r.raised_by === r.sender_id;
      return {
        id: r.id,
        state: r.state,
        reason: r.reason,
        raised_by: {
          id: r.raised_by,
          name: isSenderRaiser ? r.sender_name : r.receiver_name,
          role: isSenderRaiser ? 'sender' : 'receiver',
        },
        transaction: {
          id: r.txn_id,
          ref: r.txn_ref,
          amount_paisa: r.txn_amount,
          state: r.txn_state,
          created_at: r.txn_created_at,
        },
        counterparty: {
          id: isSenderRaiser ? r.receiver_id : r.sender_id,
          name: isSenderRaiser ? r.receiver_name : r.sender_name,
        },
        reversible_now: (r.receiver_balance ?? 0) >= r.txn_amount,
        attempts: r.attempts,
        last_attempt_error: r.last_attempt_error,
      };
    });

    return {
      items,
      next_cursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
      has_more: hasMore,
    };
  }

  async resolve(params: ResolveDisputeParams) {
    const { adminId, disputeId, action, resolution, idemKey, stepUpToken } = params;

    requireStepUp({ userId: adminId, token: stepUpToken, reason: 'ADMIN_ACTION', always: true });

    const reqHash = sha256(canonical({ adminId, disputeId, action, resolution }));

    try {
      return await withTransaction(this.pool, async (t) => {
        const claim = await claimIdempotencyKey(t, adminId, idemKey, reqHash);
        if (!claim.isNew) return claim.response;

        const check = await t.query(`SELECT * FROM ledger.disputes WHERE id = $1 FOR UPDATE`, [disputeId]);
        const dispute = check.rows[0];
        if (!dispute) {
          throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
        }
        if (dispute.state !== 'OPEN') {
          throw new InvalidState('This dispute has already been resolved or is not in OPEN state');
        }

        let response: unknown;

        if (action === 'REJECT') {
          const updateRes = await t.query(
            `UPDATE ledger.disputes
             SET state = 'REJECTED', resolution = $1, resolved_by = $2, resolved_at = now()
             WHERE id = $3 AND state = 'OPEN'
             RETURNING *`,
            [resolution, adminId, disputeId],
          );
          if (!updateRes.rowCount) {
            throw new InvalidState('This dispute has already been resolved');
          }
          const updated = updateRes.rows[0];

          await t.query(
            `INSERT INTO ledger.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after)
             VALUES ($1, 'ADMIN', 'DISPUTE_REJECT', 'dispute', $2, $3, $4)`,
            [adminId, disputeId, JSON.stringify(dispute), JSON.stringify(updated)],
          );

          response = {
            dispute: {
              id: updated.id,
              state: 'REJECTED',
              resolution: updated.resolution,
            },
          };
        } else if (action === 'REVERSE') {
          const reversal = await this.reversalCore.applyReversal(t, dispute.txn_id);

          const updateRes = await t.query(
            `UPDATE ledger.disputes
             SET state = 'REVERSED', resolution = $1, resolved_by = $2, resolved_at = now(), reversal_txn_id = $3
             WHERE id = $4 AND state = 'OPEN'
             RETURNING *`,
            [resolution, adminId, reversal.transaction.id, disputeId],
          );
          if (!updateRes.rowCount) {
            throw new InvalidState('This dispute has already been resolved');
          }
          const updated = updateRes.rows[0];

          await t.query(
            `INSERT INTO ledger.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after)
             VALUES ($1, 'ADMIN', 'DISPUTE_REVERSE', 'dispute', $2, $3, $4)`,
            [adminId, disputeId, JSON.stringify(dispute), JSON.stringify(updated)],
          );

          response = {
            dispute: {
              id: updated.id,
              state: 'REVERSED',
              resolved_by: adminId,
              resolution: updated.resolution,
            },
            reversal: {
              id: reversal.transaction.id,
              ref: reversal.transaction.ref,
              kind: reversal.transaction.kind,
            },
          };
        } else {
          throw new AppError(400, 'VALIDATION_ERROR', `Unknown action: ${action}`);
        }

        await storeIdempotencyResponse(t, adminId, idemKey, response);
        return response;
      });
    } catch (err: any) {
      // Record failure attempt outside the rolled-back transaction
      try {
        await this.pool.query(
          `UPDATE ledger.disputes
           SET attempts = attempts + 1, last_attempt_at = now(), last_attempt_error = $1
           WHERE id = $2`,
          [err.message || 'Resolution failed', disputeId],
        );
      } catch {
        // Suppress secondary logging error so primary error is returned
      }
      throw err;
    }
  }
}
