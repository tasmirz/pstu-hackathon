/**
 * The simulator connects to Postgres two ways, deliberately:
 *  - `adminUrl` (direct :5432, `postgres` owner) — for reading the integrity
 *    views and for seeding, same as scripts/apply-schema.js.
 *  - `txnSvcUrl` (:6432 via PgBouncer, the `txn_svc` role) — used ONLY to
 *    prove the append-only permission boundary (LED-05/06). Using the real
 *    least-privilege role is the point: this must fail because the ROLE
 *    can't do it, not because the query is wrong.
 *
 * SIMULATOR.md §3.4: timing-sensitive scenarios read their windows from env
 * so they can be fast and deterministic in the harness (UNDO_WINDOW_SECONDS=3,
 * SWEEPER_INTERVAL_MS=250) without touching production defaults.
 */
export const simConfig = {
  adminUrl: process.env.SIM_ADMIN_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/pstu',
  txnSvcUrl: process.env.SIM_TXN_SVC_DATABASE_URL || 'postgres://txn_svc:changeme_txn@localhost:6432/pstu',
  apiBaseUrl: process.env.SIM_API_BASE_URL || 'http://localhost:3000',
};
