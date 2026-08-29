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
import { AccountsRepository } from '../core/accounts.repository';
import { LEDGER_WRITER_PORT, LedgerWriterPort } from '../core/ledger-writer.port';

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
    @Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort,
    private readonly accounts: AccountsRepository,
  ) {}

  async raise(userId: number, txnId: number, reason: string) {
    return withTransaction(this.pool, async (t) => {
      const txnRes = await t.query(
        `SELECT id, sender_id, receiver_id, amount, created_at FROM ledger.transactions WHERE id = $1 FOR UPDATE`,
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

      // Check for existing open dispute
      const existing = await t.query(
        `SELECT id FROM ledger.disputes WHERE txn_id = $1 AND state = 'OPEN'`,
        [txnId],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new DisputeAlreadyOpen();
      }

      // Secure funds on open (Round 7 / DM-01..03)
      const userAccountId = await this.accounts.getUserAccountId(t, txn.receiver_id);
      const lockedAcc = await t.query(
        `SELECT id, balance FROM ledger.accounts WHERE id = $1 FOR UPDATE`,
        [userAccountId],
      );
      const balance = lockedAcc.rows[0]?.balance ?? 0;

      const disputeHoldRes = await t.query(
        `SELECT COALESCE(SUM(d.secured_amount), 0) AS dispute_holds
         FROM ledger.disputes d
         JOIN ledger.transactions t ON t.id = d.txn_id
         WHERE t.receiver_id = $1 AND d.state = 'OPEN'`,
        [txn.receiver_id],
      );
      const existingHolds = parseInt(disputeHoldRes.rows[0]?.dispute_holds ?? '0', 10);
      const available = Math.max(0, balance - existingHolds);
      const disputedAmount = txn.amount;
      const securedAmount = Math.max(0, Math.min(available, disputedAmount));

      try {
        const { rows } = await t.query(
          `INSERT INTO ledger.disputes (txn_id, raised_by, reason, state, secured_amount)
           VALUES ($1, $2, $3, 'OPEN', $4)
           RETURNING id, txn_id, state, secured_amount, created_at`,
          [txnId, userId, reason, securedAmount],
        );
        return rows[0];
      } catch (err: any) {
        if (err.code === '23505') {
          throw new DisputeAlreadyOpen();
        }
        throw err;
      }
    });
  }

  async listMine(userId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, txn_id, reason, state, secured_amount, refunded_amount, resolution, created_at, resolved_at
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
         d.id, d.state, d.reason, d.raised_by, d.secured_amount, d.refunded_amount, d.attempts, d.last_attempt_error, d.created_at,
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
        secured_amount: r.secured_amount,
        refunded_amount: r.refunded_amount,
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

  async listRecoveryCases(debtorId?: number) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.dispute_id, r.debtor_id, r.principal_amount, r.outstanding_amount, r.state, r.created_at,
              u.name AS debtor_name, u.phone AS debtor_phone
       FROM ledger.recovery_cases r
       JOIN auth.users_public u ON u.id = r.debtor_id
       WHERE ($1::bigint IS NULL OR r.debtor_id = $1)
       ORDER BY r.id DESC`,
      [debtorId ?? null],
    );
    return { items: rows };
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

        const txnRes = await t.query(`SELECT * FROM ledger.transactions WHERE id = $1 FOR UPDATE`, [
          dispute.txn_id,
        ]);
        const txn = txnRes.rows[0];
        if (!txn) throw new TxnNotFound();

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
          // CAS dispute state to REVERSED first so the dispute hold constraint is lifted
          const updateRes = await t.query(
            `UPDATE ledger.disputes
             SET state = 'REVERSED', resolution = $1, resolved_by = $2, resolved_at = now(),
                 refunded_amount = $3
             WHERE id = $4 AND state = 'OPEN'
             RETURNING *`,
            [resolution, adminId, dispute.secured_amount, disputeId],
          );
          if (!updateRes.rowCount) {
            throw new InvalidState('This dispute has already been resolved');
          }
          const updated = updateRes.rows[0];

          let reversalResult: any = null;
          let recoveryCase: any = null;

          if (dispute.secured_amount > 0) {
            reversalResult = await this.ledgerWriter.moveMoney(t, {
              senderId: txn.receiver_id,
              receiverId: txn.sender_id,
              amountPaisa: dispute.secured_amount,
              kind: 'REVERSAL',
              parentTxnId: txn.id,
              skipDailyLimitCheck: true,
              note: `Dispute refund: ${resolution}`,
              outboxTopic: 'txn.reversed',
            });

            await t.query(
              `UPDATE ledger.disputes SET reversal_txn_id = $1 WHERE id = $2`,
              [reversalResult.transaction.id, disputeId],
            );
          }

          if (dispute.secured_amount < txn.amount) {
            const deficit = txn.amount - dispute.secured_amount;
            const recRes = await t.query(
              `INSERT INTO ledger.recovery_cases (dispute_id, debtor_id, principal_amount, outstanding_amount, state)
               VALUES ($1, $2, $3, $4, 'OPEN')
               RETURNING *`,
              [disputeId, txn.receiver_id, deficit, deficit],
            );
            recoveryCase = recRes.rows[0];
          }

          await t.query(
            `UPDATE ledger.transactions SET state = 'REVERSED' WHERE id = $1`,
            [txn.id],
          );

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
              secured_amount: updated.secured_amount,
              refunded_amount: updated.refunded_amount,
            },
            reversal: reversalResult?.transaction ?? null,
            recovery_case: recoveryCase
              ? {
                  id: recoveryCase.id,
                  debtor_id: recoveryCase.debtor_id,
                  principal_amount: recoveryCase.principal_amount,
                  outstanding_amount: recoveryCase.outstanding_amount,
                  state: recoveryCase.state,
                }
              : null,
          };
        } else {
          throw new AppError(400, 'VALIDATION_ERROR', `Unknown action: ${action}`);
        }

        await storeIdempotencyResponse(t, adminId, idemKey, response);
        return response;
      });
    } catch (err: any) {
      try {
        const updateRes = await this.pool.query(
          `UPDATE ledger.disputes
           SET attempts = attempts + 1, last_attempt_at = now(), last_attempt_error = $1
           WHERE id = $2 RETURNING attempts, state`,
          [err.message || 'Resolution failed', disputeId],
        );
        if (err.code === 'INSUFFICIENT_FUNDS' && updateRes.rows[0]) {
          err.details = {
            ...(err.details || {}),
            dispute_state: updateRes.rows[0].state,
            attempts: updateRes.rows[0].attempts,
          };
        }
      } catch {
        // Suppress secondary error
      }
      throw err;
    }
  }
}
