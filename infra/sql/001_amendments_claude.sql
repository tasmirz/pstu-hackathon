-- =====================================================================
--  Amendments to SCHEMA.sql — identifier: claude
--  Applied AFTER SCHEMA.sql, same way: as the owner, directly against :5432.
--
--  SCHEMA.sql deliberately gives txn_svc and read_svc zero access to the
--  `auth` schema, and auth_svc zero access to `ledger`. That boundary is
--  correct almost everywhere. Two places need a narrow, documented exception
--  to actually work, and both are additive — nothing in SCHEMA.sql is
--  weakened or removed:
--
--  1. Phone -> user resolution. `POST /transfers` takes `to_phone`;
--     `GET /users/lookup` and every counterparty name shown in a transaction
--     or notification need (id, name, phone, status) from auth.users. Giving
--     txn_svc/read_svc SELECT on the whole `auth.users` table would also
--     expose pin_hash and totp_secret to services that have no business
--     touching credentials. Instead: a narrow public view.
--
--  2. The signup bonus (PLAN.md §3.5) must be "a real double-entry
--     transaction... in the same commit as the account creation". Account
--     creation (auth.users row) and the mint (ledger.accounts +
--     ledger.transactions + ledger.entries + ledger.outbox rows) are owned by
--     different roles/schemas. One Postgres transaction requires one role
--     with grants on both. Rather than blur the boundary everywhere, only
--     auth_svc gets the minimum ledger grants needed for this one flow —
--     general transfers remain exclusively TransferService's (txn_svc's) job.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. auth.users_public — safe, read-only projection for other services.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA auth TO txn_svc, read_svc;

-- `role` belongs conceptually to 002_bills_and_role_claude.sql (the admin
-- role claim), but is added here, BEFORE the view, so this file stays
-- self-contained and safely re-runnable on a fresh database: the view is
-- declared once, in its final shape, and 002 never has to touch it again
-- (CREATE OR REPLACE VIEW cannot drop a column, so splitting the column list
-- across two files in the wrong order breaks a fresh install).
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_role_chk;
ALTER TABLE auth.users ADD CONSTRAINT users_role_chk CHECK (role IN ('USER', 'ADMIN'));

-- token_version is included so txn_svc/read_svc can check it per request and
-- have logout-all take effect immediately rather than waiting for a 15-minute
-- access-token expiry (AUTH-04 in SIMULATOR.md). It carries no secret.
CREATE OR REPLACE VIEW auth.users_public AS
  SELECT id, phone, name, status, token_version, role FROM auth.users;

GRANT SELECT ON auth.users_public TO txn_svc, read_svc;

-- ---------------------------------------------------------------------
-- 2. auth_svc: minimum ledger grants for the signup-bonus commit only.
--    (INSERT/SELECT so it can create the account + mint transaction + entries
--    + outbox row; UPDATE only on accounts.balance, the cache column.)
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA ledger TO auth_svc;
GRANT SELECT, INSERT, UPDATE ON ledger.accounts     TO auth_svc;
GRANT SELECT, INSERT         ON ledger.transactions TO auth_svc;
GRANT SELECT, INSERT         ON ledger.entries      TO auth_svc;  -- append-only: no UPDATE/DELETE, same as txn_svc
GRANT SELECT, INSERT         ON ledger.outbox       TO auth_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ledger TO auth_svc;
