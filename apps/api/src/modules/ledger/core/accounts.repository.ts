import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/** HOLD/ESCROW accounts are per-user, never global (PLAN.md §4.2) — a shared
 * HOLD row would be FOR UPDATE-locked by every held transfer in the system. */
@Injectable()
export class AccountsRepository {
  async getUserAccountId(client: PoolClient, userId: number): Promise<number> {
    const { rows } = await client.query(
      `SELECT id FROM ledger.accounts WHERE user_id = $1 AND type = 'USER'`,
      [userId],
    );
    if (!rows[0]) {
      // Registration always creates this row in the same commit as the user
      // (PLAN.md §3.5) — reaching here is a data-integrity bug, not a 404.
      throw new Error(`No USER ledger account for user_id=${userId}`);
    }
    return rows[0].id;
  }

  async getOrCreateHoldAccountId(client: PoolClient, userId: number): Promise<number> {
    await client.query(
      `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'HOLD', 0)
       ON CONFLICT (user_id, type) WHERE user_id IS NOT NULL DO NOTHING`,
      [userId],
    );
    const { rows } = await client.query(`SELECT id FROM ledger.accounts WHERE user_id = $1 AND type = 'HOLD'`, [
      userId,
    ]);
    return rows[0].id;
  }

  async getBalance(client: PoolClient, accountId: number): Promise<number> {
    const { rows } = await client.query(`SELECT balance FROM ledger.accounts WHERE id = $1`, [accountId]);
    return rows[0].balance;
  }

  async spentToday(client: PoolClient, accountId: number): Promise<number> {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(-amount), 0) AS spent FROM ledger.entries
        WHERE account_id = $1 AND amount < 0
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'`,
      [accountId],
    );
    return rows[0].spent;
  }

  async dailyLimit(client: PoolClient, userId: number, defaultPaisa: number): Promise<number> {
    const { rows } = await client.query(`SELECT daily_send_limit FROM ledger.limit_overrides WHERE user_id = $1`, [
      userId,
    ]);
    return rows[0]?.daily_send_limit ?? defaultPaisa;
  }
}
