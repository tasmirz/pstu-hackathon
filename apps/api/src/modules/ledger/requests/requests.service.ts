import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  canonical,
  InvalidState,
  NotAParty,
  RequestNotFound,
  SelfTransfer,
  sha256,
  VelocityExceeded,
  withTransaction,
} from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../../../common/idempotency.util';
import { requireStepUp } from '../../../common/step-up.util';
import { config } from '../../../config';
import { UsersRepository } from '../core/users.repository';
import { LEDGER_WRITER_PORT, LedgerWriterPort } from '../core/ledger-writer.port';

export const REQUEST_EXPIRATION_HOURS = 24;

export interface PayRequestParams {
  payerId: number;
  requestId: number;
  idemKey: string;
  stepUpToken?: string;
}

@Injectable()
export class RequestsService {
  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    @Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort,
    private readonly users: UsersRepository,
  ) {}

  async create(requesterId: number, fromPhone: string, amountPaisa: number, note?: string) {
    const payer = await this.users.findByPhone(fromPhone);
    if (payer.id === requesterId) {
      throw new SelfTransfer();
    }

    const { rows } = await this.pool.query(
      `INSERT INTO ledger.money_requests
         (requester_id, payer_id, amount, note, state, expires_at)
       VALUES
         ($1, $2, $3, $4, 'PENDING', now() + ($5 || ' hours')::interval)
       RETURNING id, requester_id, payer_id, amount, note, state, expires_at, created_at`,
      [requesterId, payer.id, amountPaisa, note ?? null, REQUEST_EXPIRATION_HOURS],
    );

    const r = rows[0];
    return {
      id: r.id,
      requester_id: r.requester_id,
      payer_id: r.payer_id,
      from_phone: fromPhone,
      amount_paisa: r.amount,
      note: r.note,
      state: r.state,
      expires_at: r.expires_at,
      created_at: r.created_at,
    };
  }

  async pay(params: PayRequestParams) {
    const { payerId, requestId, idemKey, stepUpToken } = params;

    const reqHash = sha256(canonical({ payerId, requestId }));

    return withTransaction(this.pool, async (t) => {
      const claim = await claimIdempotencyKey(t, payerId, idemKey, reqHash);
      if (!claim.isNew) return claim.response;

      const check = await t.query(`SELECT * FROM ledger.money_requests WHERE id = $1 FOR UPDATE`, [requestId]);
      const reqRow = check.rows[0];
      if (!reqRow) throw new RequestNotFound();

      if (reqRow.payer_id !== payerId) {
        throw new NotAParty();
      }

      if (reqRow.state !== 'PENDING') {
        throw new InvalidState('This money request is not in PENDING state');
      }

      if (new Date(reqRow.expires_at).getTime() <= Date.now()) {
        await t.query(`UPDATE ledger.money_requests SET state = 'EXPIRED' WHERE id = $1 AND state = 'PENDING'`, [
          requestId,
        ]);
        throw new InvalidState('This money request has expired');
      }

      // Step-up authentication checks
      const priorTxn = await t.query(
        `SELECT 1 FROM ledger.transactions
         WHERE sender_id = $1 AND receiver_id = $2 AND state = 'COMPLETED' LIMIT 1`,
        [payerId, reqRow.requester_id],
      );
      if (priorTxn.rowCount === 0) {
        requireStepUp({ userId: payerId, token: stepUpToken, reason: 'FIRST_TIME_RECIPIENT', always: true });
      }
      requireStepUp({ userId: payerId, token: stepUpToken, reason: 'AMOUNT_THRESHOLD', amountPaisa: reqRow.amount });

      // Recipient (requester) reputation check: if below threshold, step-up is required regardless of amount
      const repRes = await t.query(
        `SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`,
        [reqRow.requester_id],
      );
      const requesterScore = repRes.rows[0]?.reputation_score ?? 50;
      if (requesterScore < config.reputationStepUpThreshold) {
        requireStepUp({ userId: payerId, token: stepUpToken, reason: 'LOW_REPUTATION_RECIPIENT', always: true });
      }

      const moveResult = await this.ledgerWriter.moveMoney(t, {
        senderId: payerId,
        receiverId: reqRow.requester_id,
        amountPaisa: reqRow.amount,
        kind: 'REQUEST_SETTLE',
        note: reqRow.note,
      });

      const updateRes = await t.query(
        `UPDATE ledger.money_requests
         SET state = 'PAID', settled_txn_id = $1
         WHERE id = $2 AND state = 'PENDING'
         RETURNING *`,
        [moveResult.transaction.id, requestId],
      );
      if (!updateRes.rowCount) {
        throw new InvalidState('This money request is no longer PENDING');
      }

      await storeIdempotencyResponse(t, payerId, idemKey, moveResult);
      return moveResult;
    });
  }

  async decline(payerId: number, requestId: number) {
    const check = await this.pool.query(`SELECT * FROM ledger.money_requests WHERE id = $1`, [requestId]);
    const reqRow = check.rows[0];
    if (!reqRow) throw new RequestNotFound();

    if (reqRow.payer_id !== payerId) {
      throw new NotAParty();
    }

    if (reqRow.state !== 'PENDING') {
      throw new InvalidState('This money request is not in PENDING state');
    }

    if (new Date(reqRow.expires_at).getTime() <= Date.now()) {
      await this.pool.query(`UPDATE ledger.money_requests SET state = 'EXPIRED' WHERE id = $1 AND state = 'PENDING'`, [
        requestId,
      ]);
      throw new InvalidState('This money request has expired');
    }

    const res = await this.pool.query(
      `UPDATE ledger.money_requests
       SET state = 'DECLINED'
       WHERE id = $1 AND state = 'PENDING' AND payer_id = $2
       RETURNING id, state`,
      [requestId, payerId],
    );
    if (!res.rowCount) {
      throw new InvalidState('This money request is no longer PENDING');
    }
    return res.rows[0];
  }

  async cancel(requesterId: number, requestId: number) {
    const check = await this.pool.query(`SELECT * FROM ledger.money_requests WHERE id = $1`, [requestId]);
    const reqRow = check.rows[0];
    if (!reqRow) throw new RequestNotFound();

    if (reqRow.requester_id !== requesterId) {
      throw new NotAParty();
    }

    if (reqRow.state !== 'PENDING') {
      throw new InvalidState('This money request is not in PENDING state');
    }

    if (new Date(reqRow.expires_at).getTime() <= Date.now()) {
      await this.pool.query(`UPDATE ledger.money_requests SET state = 'EXPIRED' WHERE id = $1 AND state = 'PENDING'`, [
        requestId,
      ]);
      throw new InvalidState('This money request has expired');
    }

    const res = await this.pool.query(
      `UPDATE ledger.money_requests
       SET state = 'CANCELLED'
       WHERE id = $1 AND state = 'PENDING' AND requester_id = $2
       RETURNING id, state`,
      [requestId, requesterId],
    );
    if (!res.rowCount) {
      throw new InvalidState('This money request is no longer PENDING');
    }
    return res.rows[0];
  }

  async remind(requesterId: number, requestId: number) {
    const check = await this.pool.query(`SELECT * FROM ledger.money_requests WHERE id = $1`, [requestId]);
    const reqRow = check.rows[0];
    if (!reqRow) throw new RequestNotFound();

    if (reqRow.requester_id !== requesterId) {
      throw new NotAParty();
    }

    if (reqRow.state !== 'PENDING') {
      throw new InvalidState('This money request is not in PENDING state');
    }

    if (new Date(reqRow.expires_at).getTime() <= Date.now()) {
      await this.pool.query(`UPDATE ledger.money_requests SET state = 'EXPIRED' WHERE id = $1 AND state = 'PENDING'`, [
        requestId,
      ]);
      throw new InvalidState('This money request has expired');
    }

    if (reqRow.reminded_at) {
      const msSinceRemind = Date.now() - new Date(reqRow.reminded_at).getTime();
      if (msSinceRemind < 3600 * 1000) {
        throw new VelocityExceeded();
      }
    }

    const res = await this.pool.query(
      `UPDATE ledger.money_requests
       SET reminded_at = now()
       WHERE id = $1 AND state = 'PENDING' AND requester_id = $2
       RETURNING id, reminded_at`,
      [requestId, requesterId],
    );
    if (!res.rowCount) {
      throw new InvalidState('This money request is no longer PENDING');
    }
    return { id: requestId, reminded: true };
  }

  async listIncoming(userId: number, state?: string, cursor?: number, limit = 20) {
    const limitPlusOne = limit + 1;

    // Lazy expiry sweep for this user's pending incoming requests
    await this.pool.query(
      `UPDATE ledger.money_requests
       SET state = 'EXPIRED'
       WHERE payer_id = $1 AND state = 'PENDING' AND expires_at <= now()`,
      [userId],
    );

    const { rows } = await this.pool.query(
      `SELECT mr.id, mr.amount, mr.note, mr.state, mr.expires_at, mr.reminded_at, mr.settled_txn_id, mr.created_at,
              u.id AS counterparty_id, u.name AS counterparty_name, u.phone AS counterparty_phone
       FROM ledger.money_requests mr
       JOIN auth.users_public u ON u.id = mr.requester_id
       WHERE mr.payer_id = $1
         AND ($2::text IS NULL OR mr.state = $2::text)
         AND ($3::bigint IS NULL OR mr.id < $3::bigint)
       ORDER BY mr.id DESC
       LIMIT $4`,
      [userId, state ?? null, cursor ?? null, limitPlusOne],
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageRows.map((r) => ({
        id: r.id,
        state: r.state,
        amount_paisa: r.amount,
        note: r.note,
        counterparty: {
          id: r.counterparty_id,
          name: r.counterparty_name,
          phone: r.counterparty_phone,
        },
        expires_at: r.expires_at,
        reminded_at: r.reminded_at,
        settled_txn_id: r.settled_txn_id,
        created_at: r.created_at,
      })),
      next_cursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      has_more: hasMore,
    };
  }

  async listOutgoing(userId: number, state?: string, cursor?: number, limit = 20) {
    const limitPlusOne = limit + 1;

    // Lazy expiry sweep for this user's pending outgoing requests
    await this.pool.query(
      `UPDATE ledger.money_requests
       SET state = 'EXPIRED'
       WHERE requester_id = $1 AND state = 'PENDING' AND expires_at <= now()`,
      [userId],
    );

    const { rows } = await this.pool.query(
      `SELECT mr.id, mr.amount, mr.note, mr.state, mr.expires_at, mr.reminded_at, mr.settled_txn_id, mr.created_at,
              u.id AS counterparty_id, u.name AS counterparty_name, u.phone AS counterparty_phone
       FROM ledger.money_requests mr
       JOIN auth.users_public u ON u.id = mr.payer_id
       WHERE mr.requester_id = $1
         AND ($2::text IS NULL OR mr.state = $2::text)
         AND ($3::bigint IS NULL OR mr.id < $3::bigint)
       ORDER BY mr.id DESC
       LIMIT $4`,
      [userId, state ?? null, cursor ?? null, limitPlusOne],
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageRows.map((r) => ({
        id: r.id,
        state: r.state,
        amount_paisa: r.amount,
        note: r.note,
        counterparty: {
          id: r.counterparty_id,
          name: r.counterparty_name,
          phone: r.counterparty_phone,
        },
        expires_at: r.expires_at,
        reminded_at: r.reminded_at,
        settled_txn_id: r.settled_txn_id,
        created_at: r.created_at,
      })),
      next_cursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      has_more: hasMore,
    };
  }
}
