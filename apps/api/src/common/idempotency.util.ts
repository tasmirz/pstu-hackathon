import { PoolClient } from 'pg';
import { IdempotencyKeyReuse } from '@pstu/shared';

/**
 * Claim an idempotency key inside the caller's transaction, BEFORE any
 * business logic runs (PLAN.md §3.2 step 1). The PK is (user_id, key), never
 * key alone — a globally-unique key would let user A replay user B's cached
 * response by guessing it (SIMULATOR.md IDEM-04).
 *
 * A concurrent duplicate's INSERT blocks on the unique index until the first
 * transaction commits or rolls back, so by the time we read `response` back
 * here it is already populated (or the row is gone, if the first attempt
 * rolled back — in which case this caller wins the claim instead).
 */
export async function claimIdempotencyKey(
  client: PoolClient,
  userId: number,
  key: string,
  requestHash: string,
): Promise<{ isNew: true } | { isNew: false; response: unknown }> {
  const claimed = await client.query(
    `INSERT INTO ledger.idempotency_keys (user_id, key, request_hash)
     VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
    [userId, key, requestHash],
  );
  if (claimed.rowCount) return { isNew: true };

  const prior = await client.query(
    `SELECT request_hash, response FROM ledger.idempotency_keys WHERE user_id = $1 AND key = $2`,
    [userId, key],
  );
  const row = prior.rows[0];
  if (!row || row.request_hash !== requestHash) throw new IdempotencyKeyReuse();
  return { isNew: false, response: row.response };
}

export async function storeIdempotencyResponse(
  client: PoolClient,
  userId: number,
  key: string,
  response: unknown,
): Promise<void> {
  await client.query(`UPDATE ledger.idempotency_keys SET response = $1 WHERE user_id = $2 AND key = $3`, [
    JSON.stringify(response),
    userId,
    key,
  ]);
}
