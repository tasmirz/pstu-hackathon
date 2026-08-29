import { Inject, Injectable } from '@nestjs/common';
import { TxnNotFound, UserNotFound } from '@pstu/shared';
import { Pool } from 'pg';
import { config } from '../../config';
import { READ_POOL } from '../../db/db.module';
import { TransactionListQueryDto } from './dto';

@Injectable()
export class QueryService {
  constructor(@Inject(READ_POOL) private readonly pool: Pool) {}

  async balance(userId: number) {
    const result = await this.pool.query<{ balance_paisa: number; held_paisa: number }>(
      `SELECT COALESCE(MAX(balance) FILTER (WHERE type = 'USER'), 0) AS balance_paisa,
              COALESCE(MAX(balance) FILTER (WHERE type = 'HOLD'), 0) AS held_paisa
         FROM ledger.accounts WHERE user_id = $1`,
      [userId],
    );
    const balancePaisa = result.rows[0].balance_paisa;
    // HOLD accounts are not created until the deferred undo-window feature is implemented.
    const heldPaisa = result.rows[0].held_paisa;
    return {
      balance_paisa: balancePaisa,
      held_paisa: heldPaisa,
      available_paisa: balancePaisa - heldPaisa,
    };
  }

  async limits(userId: number) {
    const result = await this.pool.query<{
      daily_limit_paisa: number;
      spent_today_paisa: number;
      resets_at: Date;
    }>(
      `SELECT COALESCE(lo.daily_send_limit, $2) AS daily_limit_paisa,
              COALESCE((
                SELECT SUM(-e.amount)
                  FROM ledger.entries e
                  JOIN ledger.accounts a ON a.id = e.account_id
                 WHERE a.user_id = $1 AND a.type = 'USER' AND e.amount < 0
                   AND e.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'
              ), 0) AS spent_today_paisa,
              (date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') + interval '1 day')
                AT TIME ZONE 'Asia/Dhaka' AS resets_at
         FROM (VALUES (1)) AS seed(n)
         LEFT JOIN ledger.limit_overrides lo ON lo.user_id = $1`,
      [userId, config.dailyLimitDefaultPaisa],
    );
    const row = result.rows[0];
    return {
      daily_limit_paisa: row.daily_limit_paisa,
      spent_today_paisa: row.spent_today_paisa,
      remaining_paisa: Math.max(0, row.daily_limit_paisa - row.spent_today_paisa),
      resets_at: row.resets_at.toISOString(),
    };
  }

  async transactions(userId: number, query: TransactionListQueryDto) {
    const params: unknown[] = [userId];
    const conditions = [`(t.sender_id = $1 OR t.receiver_id = $1)`];

    if (query.cursor !== undefined) {
      params.push(query.cursor);
      conditions.push(`t.id < $${params.length}`);
    }
    if (query.direction === 'sent') conditions.push(`t.sender_id = $1`);
    if (query.direction === 'received') conditions.push(`t.receiver_id = $1`);
    if (query.kind) {
      params.push(query.kind);
      conditions.push(`t.kind = $${params.length}`);
    }
    params.push(query.limit + 1);

    const result = await this.pool.query(
      `SELECT t.id, t.ref, t.kind, t.state, t.amount AS amount_paisa, t.note,
              t.reverses_txn_id, t.settle_after, t.created_at,
              CASE WHEN t.sender_id = $1 THEN 'sent' ELSE 'received' END AS direction,
              cp.id AS counterparty_id, cp.name AS counterparty_name, cp.phone AS counterparty_phone
         FROM ledger.transactions t
         LEFT JOIN auth.users_public cp
           ON cp.id = CASE WHEN t.sender_id = $1 THEN t.receiver_id ELSE t.sender_id END
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const items = rows.map((row) => this.shapeTransaction(row));
    return {
      items,
      next_cursor: hasMore && rows.length ? rows[rows.length - 1].id : null,
      has_more: hasMore,
    };
  }

  async transaction(userId: number, transactionId: number) {
    const result = await this.pool.query(
      `SELECT t.id, t.ref, t.kind, t.state, t.amount AS amount_paisa, t.note,
              t.sender_id, t.receiver_id, t.reverses_txn_id, t.settle_after, t.created_at,
              CASE WHEN t.sender_id = $1 THEN 'sent' ELSE 'received' END AS direction,
              cp.id AS counterparty_id, cp.name AS counterparty_name, cp.phone AS counterparty_phone
         FROM ledger.transactions t
         LEFT JOIN auth.users_public cp
           ON cp.id = CASE WHEN t.sender_id = $1 THEN t.receiver_id ELSE t.sender_id END
        WHERE t.id = $2 AND (t.sender_id = $1 OR t.receiver_id = $1)`,
      [userId, transactionId],
    );
    const row = result.rows[0];
    if (!row) throw new TxnNotFound();

    const [entries, reversal] = await Promise.all([
      this.pool.query(
        `SELECT e.account_id, a.type AS account_type, e.amount AS amount_paisa
           FROM ledger.entries e
           JOIN ledger.accounts a ON a.id = e.account_id
          WHERE e.txn_id = $1 ORDER BY e.id`,
        [transactionId],
      ),
      this.pool.query(
        `SELECT id, created_at FROM ledger.transactions
          WHERE reverses_txn_id = $1 AND kind = 'REVERSAL' LIMIT 1`,
        [transactionId],
      ),
    ]);

    return {
      ...this.shapeTransaction(row),
      entries: entries.rows,
      reversal: reversal.rows[0] ?? null,
      can_reverse: row.state === 'COMPLETED' && row.kind !== 'REVERSAL' && row.sender_id === userId,
    };
  }

  async lookupUser(requesterId: number, phone: string) {
    const found = await this.pool.query<{ id: number; phone: string; name: string }>(
      `SELECT id, phone, name FROM auth.users_public WHERE phone = $1`,
      [phone],
    );
    const user = found.rows[0];
    if (!user) throw new UserNotFound();

    const prior = await this.pool.query(
      `SELECT 1 FROM ledger.transactions
        WHERE state = 'COMPLETED'
          AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
        LIMIT 1`,
      [requesterId, user.id],
    );
    return {
      id: user.id,
      name: this.firstNameAndLastInitial(user.name),
      phone: user.phone,
      is_first_time: prior.rowCount === 0,
    };
  }

  private shapeTransaction(row: any) {
    const counterparty = row.counterparty_id
      ? { id: row.counterparty_id, name: row.counterparty_name, phone: row.counterparty_phone }
      : undefined;
    return {
      id: row.id,
      ref: row.ref,
      kind: row.kind,
      state: row.state,
      direction: row.direction,
      amount_paisa: row.amount_paisa,
      note: row.note,
      ...(counterparty ? { counterparty } : {}),
      reverses_txn_id: row.reverses_txn_id,
      settle_after: row.settle_after,
      created_at: row.created_at,
    };
  }

  private firstNameAndLastInitial(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] ?? '';
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
}
