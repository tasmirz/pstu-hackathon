import { Pool } from 'pg';

/**
 * The five universal checks (SIMULATOR.md §1). Every one of these is pure
 * SQL against the live database — no API required, which is why this file
 * exists before `client.ts` and works today regardless of whether the app
 * has finished booting.
 */

export interface InvariantSnapshot {
  conservationTotalPaisa: number;
  driftRows: Array<{ account_id: number; user_id: number | null; type: string; cached_paisa: number; derived_paisa: number; drift_paisa: number }>;
  negativeRows: Array<{ account_id: number; user_id: number | null; type: string; balance: number }>;
  unbalancedTxns: Array<{ txn_id: number; legs: number; total: number }>;
}

export async function snapshotInvariants(adminPool: Pool): Promise<InvariantSnapshot> {
  const [cons, drift, neg, unbalanced] = await Promise.all([
    adminPool.query(`SELECT total_paisa FROM ledger.v_conservation`),
    adminPool.query(`SELECT * FROM ledger.v_balance_drift`),
    adminPool.query(`SELECT * FROM ledger.v_negative_accounts`),
    adminPool.query(`
      SELECT txn_id, COUNT(*)::int AS legs, SUM(amount) AS total
        FROM ledger.entries
       GROUP BY txn_id
      HAVING COUNT(*) < 2 OR SUM(amount) <> 0
    `),
  ]);
  return {
    conservationTotalPaisa: cons.rows[0].total_paisa,
    driftRows: drift.rows,
    negativeRows: neg.rows,
    unbalancedTxns: unbalanced.rows,
  };
}

export interface InvariantResult {
  ok: boolean;
  failures: string[];
  snapshot: InvariantSnapshot;
}

/** Structural checks only (conservation / drift / negative / every-txn-balances).
 * Append-only (LED-05/06) is a separate, one-time permission check — see
 * `checkAppendOnly` below — not re-run after every scenario, since it never
 * changes at runtime and re-opening a role connection per scenario is waste. */
export async function checkStructuralInvariants(adminPool: Pool): Promise<InvariantResult> {
  const snapshot = await snapshotInvariants(adminPool);
  const failures: string[] = [];

  if (snapshot.conservationTotalPaisa !== 0) {
    failures.push(`conservation broken: SUM(ledger.entries.amount) = ${snapshot.conservationTotalPaisa}, expected 0`);
  }
  if (snapshot.driftRows.length > 0) {
    failures.push(
      `balance drift on ${snapshot.driftRows.length} account(s): ` +
        snapshot.driftRows.map((r) => `#${r.account_id} cached=${r.cached_paisa} derived=${r.derived_paisa}`).join('; '),
    );
  }
  if (snapshot.negativeRows.length > 0) {
    failures.push(
      `negative balance on ${snapshot.negativeRows.length} non-mint account(s): ` +
        snapshot.negativeRows.map((r) => `#${r.account_id} (${r.type}) = ${r.balance}`).join('; '),
    );
  }
  if (snapshot.unbalancedTxns.length > 0) {
    failures.push(
      `${snapshot.unbalancedTxns.length} unbalanced/incomplete transaction(s): ` +
        snapshot.unbalancedTxns.map((t) => `txn ${t.txn_id}: ${t.legs} leg(s), sum=${t.total}`).join('; '),
    );
  }

  return { ok: failures.length === 0, failures, snapshot };
}

export interface AppendOnlyResult {
  updateDenied: boolean;
  deleteDenied: boolean;
  detail: string;
}

/**
 * LED-05/06: `txn_svc` must be structurally unable to edit or delete a
 * ledger entry — this connects AS that role (via PgBouncer, same as the
 * real app) and proves the denial is a database permission, not an
 * application `if`. Anything other than a `permission denied` error here
 * is itself a failure worth surfacing verbatim.
 */
export async function checkAppendOnly(txnSvcPool: Pool): Promise<AppendOnlyResult> {
  let updateDenied = false;
  let deleteDenied = false;
  const details: string[] = [];

  try {
    await txnSvcPool.query(`UPDATE ledger.entries SET amount = 999 WHERE id = 1`);
    details.push('UPDATE unexpectedly SUCCEEDED — append-only is broken');
  } catch (err: any) {
    updateDenied = err.code === '42501' || /permission denied/i.test(err.message);
    if (!updateDenied) details.push(`UPDATE failed for the wrong reason: ${err.message}`);
  }

  try {
    await txnSvcPool.query(`DELETE FROM ledger.entries WHERE id = 1`);
    details.push('DELETE unexpectedly SUCCEEDED — append-only is broken');
  } catch (err: any) {
    deleteDenied = err.code === '42501' || /permission denied/i.test(err.message);
    if (!deleteDenied) details.push(`DELETE failed for the wrong reason: ${err.message}`);
  }

  return { updateDenied, deleteDenied, detail: details.join('; ') || 'both denied as expected' };
}

/**
 * LED-07: a single hand-inserted, unbalanced leg must be rejected AT
 * COMMIT by `ledger.assert_balanced()` (a DEFERRABLE INITIALLY DEFERRED
 * constraint trigger) — not by application code. `entries.txn_id` and
 * `account_id` carry no FK (SCHEMA.sql, deliberately), so any integers work
 * here; nothing needs to pre-exist.
 */
export async function checkUnbalancedLegRejected(adminPool: Pool): Promise<{ rejected: boolean; detail: string }> {
  const client = await adminPool.connect();
  const fakeTxnId = -Math.floor(Math.random() * 1_000_000_000) - 1; // negative = never collides with a real BIGSERIAL id
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO ledger.entries (txn_id, account_id, amount) VALUES ($1, 1, 1)`, [fakeTxnId]);
    await client.query('COMMIT');
    return { rejected: false, detail: 'COMMIT unexpectedly succeeded — assert_balanced() did not fire' };
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    const isBalanceError = /unbalanced|has only \d+ leg/i.test(err.message);
    return {
      rejected: isBalanceError,
      detail: isBalanceError ? err.message : `COMMIT failed for the wrong reason: ${err.message}`,
    };
  } finally {
    client.release();
  }
}
