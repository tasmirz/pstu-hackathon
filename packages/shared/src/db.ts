import { Pool, PoolClient, PoolConfig, types } from 'pg';

// int8 (BIGINT, oid 20) comes back from `pg` as a STRING by default, because it
// can exceed JS's safe integer range. Every BIGINT in this system is paisa;
// max paisa is 9.007e15 (~৳90 trillion) — safely inside Number.MAX_SAFE_INTEGER
// (9.007e15) — so parseInt is exact here. Without this, `balance - amount`
// becomes NaN and `balance + amount` becomes string concatenation: silent
// money corruption (PLAN.md §2.4). Do NOT switch to BigInt — JSON.stringify
// throws on BigInt values and would take down every response serializer.
types.setTypeParser(20, (v: string) => parseInt(v, 10));
types.setTypeParser(1700, (v: string) => parseInt(v, 10));

export function createPool(config: PoolConfig): Pool {
  return new Pool(config);
}

/**
 * Runs `fn` inside a single transaction on a dedicated client. Commits on
 * success, rolls back on any thrown error, always releases the client.
 * Every money-moving code path uses this — never a bare pool.query for writes
 * that must be atomic.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* connection may already be dead; nothing more to do */
    });
    throw err;
  } finally {
    client.release();
  }
}

export type { Pool, PoolClient, PoolConfig };
