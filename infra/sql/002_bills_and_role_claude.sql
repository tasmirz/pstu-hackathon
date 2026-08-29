-- =====================================================================
--  Amendments, part 2 — identifier: claude
--  Adds: admin role claim, and the shared-bill-payment feature
--  (ledger.bills / ledger.bill_shares — not in the original SCHEMA.sql).
-- =====================================================================

-- Admin role claim (API.md "Admin — separate ADMIN role claim") now lives in
-- 001_amendments_claude.sql, added before auth.users_public is first
-- declared so a fresh install never hits "cannot drop columns from view".

-- ---------------------------------------------------------------------
-- Multi-user shared bill payment. One bill, several payers, each owing
-- their own share. The bill settles once every share is PAID. Each share
-- settlement is an ordinary double-entry transfer (payer -> bill creator),
-- so this table records the *business process*; ledger.transactions /
-- ledger.entries still record the *money*, same as everywhere else.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.bills (
  id           BIGSERIAL PRIMARY KEY,
  ref          TEXT        NOT NULL UNIQUE,
  created_by   BIGINT      NOT NULL,          -- logical FK to auth.users
  title        TEXT        NOT NULL,
  total_amount BIGINT      NOT NULL CHECK (total_amount > 0),
  state        TEXT        NOT NULL DEFAULT 'OPEN',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bills_state_chk CHECK (state IN ('OPEN', 'SETTLED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS bills_created_by_idx ON ledger.bills (created_by, id DESC);

CREATE TABLE IF NOT EXISTS ledger.bill_shares (
  id             BIGSERIAL PRIMARY KEY,
  bill_id        BIGINT      NOT NULL REFERENCES ledger.bills(id),
  payer_id       BIGINT      NOT NULL,        -- logical FK to auth.users
  amount         BIGINT      NOT NULL CHECK (amount > 0),
  state          TEXT        NOT NULL DEFAULT 'PENDING',
  settled_txn_id BIGINT      REFERENCES ledger.transactions(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bill_shares_state_chk CHECK (state IN ('PENDING', 'PAID', 'CANCELLED')),
  -- One share per payer per bill — a second POST /bills/:id/shares/:payer
  -- is a bug or a retry, never a second debt.
  CONSTRAINT bill_shares_one_per_payer UNIQUE (bill_id, payer_id)
);

CREATE INDEX IF NOT EXISTS bill_shares_payer_pending_idx ON ledger.bill_shares (payer_id, id DESC) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS bill_shares_bill_id_idx ON ledger.bill_shares (bill_id);

GRANT SELECT, INSERT, UPDATE ON ledger.bills, ledger.bill_shares TO txn_svc;
GRANT SELECT ON ledger.bills, ledger.bill_shares TO read_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ledger TO txn_svc;
