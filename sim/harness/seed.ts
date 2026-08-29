import { randomUUID } from 'crypto';
import { Pool } from 'pg';

/**
 * Ephemeral account factory — direct SQL, not the HTTP API. SIMULATOR.md §2
 * says scenarios use `ctx.freshUsers(n)` and never collide because every
 * phone number is unique per call; it doesn't say that has to go through
 * `POST /auth/register`, and going direct means the LEDGER group runs today
 * even before the API is fully up. Once `client.ts` exists, HAP/IDEM/etc.
 * scenarios that need a *real* signup (to prove the bonus is a real
 * transaction, auth flows, etc.) call the API directly instead of this.
 *
 * Mirrors exactly what `POST /auth/register` does (packages/shared's
 * `newTxnRef`, the SIGNUP_BONUS shape) so seeded accounts are
 * indistinguishable from ones created through the real endpoint.
 */
export interface SeededUser {
  id: number;
  phone: string;
  name: string;
  accountId: number;
}

let seedCounter = 0;

export async function freshUser(adminPool: Pool, name = 'Sim User'): Promise<SeededUser> {
  seedCounter += 1;
  const phone = `+8809${Date.now().toString().slice(-6)}${String(seedCounter).padStart(3, '0')}`;
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query(
      `INSERT INTO auth.users (phone, name, pin_hash, status, role)
       VALUES ($1, $2, 'sim-not-a-real-hash', 'ACTIVE', 'USER') RETURNING id`,
      [phone, name],
    );
    const userId = userRes.rows[0].id;

    const acctRes = await client.query(
      `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 0) RETURNING id`,
      [userId],
    );
    const accountId = acctRes.rows[0].id;

    const mintRes = await client.query(`SELECT id FROM ledger.accounts WHERE type = 'SYSTEM_MINT' LIMIT 1`);
    const mintAccountId = mintRes.rows[0].id;
    const bonus = 10_000_000; // ৳100,000 — same constant as config.signupBonusPaisa

    const txnRes = await client.query(
      `INSERT INTO ledger.transactions (ref, kind, state, sender_id, receiver_id, amount, note)
       VALUES ($1, 'SIGNUP_BONUS', 'COMPLETED', NULL, $2, $3, 'Welcome bonus (simulator seed)') RETURNING id`,
      [`TXN_SIM_${randomUUID()}`, userId, bonus],
    );
    await client.query(
      `INSERT INTO ledger.entries (txn_id, account_id, amount) VALUES ($1, $2, $3), ($1, $4, $5)`,
      [txnRes.rows[0].id, mintAccountId, -bonus, accountId, bonus],
    );
    await client.query(`UPDATE ledger.accounts SET balance = balance - $1 WHERE id = $2`, [bonus, mintAccountId]);
    await client.query(`UPDATE ledger.accounts SET balance = balance + $1 WHERE id = $2`, [bonus, accountId]);

    await client.query('COMMIT');
    return { id: userId, phone, name, accountId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function freshUsers(adminPool: Pool, n: number, namePrefix = 'Sim User'): Promise<SeededUser[]> {
  const users: SeededUser[] = [];
  for (let i = 0; i < n; i += 1) {
    users.push(await freshUser(adminPool, `${namePrefix} ${i + 1}`));
  }
  return users;
}

export async function getBalance(adminPool: Pool, accountId: number): Promise<number> {
  const { rows } = await adminPool.query(`SELECT balance FROM ledger.accounts WHERE id = $1`, [accountId]);
  return rows[0]?.balance ?? 0;
}
