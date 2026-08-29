-- ---------------------------------------------------------------------
-- 007_extra_features_antigravity.sql
-- Rounds 7, 8, 9 & TOTP: Dispute Escrow & Recovery, Bill Split Partial,
-- Group Payments, and TOTP support.
-- ---------------------------------------------------------------------

-- 1. Dispute Escrow & Recovery (Round 7 / DM-01..09)
ALTER TABLE ledger.disputes
  ADD COLUMN IF NOT EXISTS secured_amount BIGINT NOT NULL DEFAULT 0 CHECK (secured_amount >= 0),
  ADD COLUMN IF NOT EXISTS refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);

ALTER TABLE ledger.disputes DROP CONSTRAINT IF EXISTS dispute_state_chk;
ALTER TABLE ledger.disputes ADD CONSTRAINT dispute_state_chk
  CHECK (state IN ('OPEN', 'REVERSED', 'REJECTED', 'PARTIALLY_REFUNDED'));

CREATE TABLE IF NOT EXISTS ledger.recovery_cases (
  id                 BIGSERIAL PRIMARY KEY,
  dispute_id         BIGINT NOT NULL REFERENCES ledger.disputes(id),
  debtor_id          BIGINT NOT NULL,
  principal_amount   BIGINT NOT NULL CHECK (principal_amount > 0),
  outstanding_amount BIGINT NOT NULL CHECK (outstanding_amount >= 0),
  state              TEXT NOT NULL DEFAULT 'OPEN',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recovery_state_chk CHECK (state IN ('OPEN', 'RECOVERED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS recovery_debtor_idx ON ledger.recovery_cases (debtor_id, id DESC);
CREATE INDEX IF NOT EXISTS recovery_dispute_idx ON ledger.recovery_cases (dispute_id);

-- 2. Bill Split Equal Mode & Partial Payments (Round 8 / BS-01..07)
ALTER TABLE ledger.bills
  ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'CUSTOM' CHECK (split_mode IN ('CUSTOM', 'EQUAL'));

ALTER TABLE ledger.bill_shares
  ADD COLUMN IF NOT EXISTS paid_amount BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE ledger.bill_shares DROP CONSTRAINT IF EXISTS bill_shares_state_chk;
ALTER TABLE ledger.bill_shares ADD CONSTRAINT bill_shares_state_chk
  CHECK (state IN ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'));

CREATE TABLE IF NOT EXISTS ledger.bill_payments (
  id         BIGSERIAL PRIMARY KEY,
  bill_id    BIGINT NOT NULL REFERENCES ledger.bills(id),
  share_id   BIGINT NOT NULL REFERENCES ledger.bill_shares(id),
  payer_id   BIGINT NOT NULL,
  amount     BIGINT NOT NULL CHECK (amount > 0),
  txn_id     BIGINT REFERENCES ledger.transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bill_payments_share_idx ON ledger.bill_payments (share_id, id DESC);

-- 3. Group Payments (Round 9 / GP-01..07)
CREATE TABLE IF NOT EXISTS ledger.group_batches (
  id                 BIGSERIAL PRIMARY KEY,
  sender_id          BIGINT NOT NULL,
  total_amount_paisa BIGINT NOT NULL CHECK (total_amount_paisa > 0),
  item_count         INT NOT NULL CHECK (item_count > 0),
  title              TEXT,
  state              TEXT NOT NULL DEFAULT 'PROCESSING',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT group_batch_state_chk CHECK (state IN ('PROCESSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'))
);

CREATE TABLE IF NOT EXISTS ledger.group_batch_items (
  id           BIGSERIAL PRIMARY KEY,
  batch_id     BIGINT NOT NULL REFERENCES ledger.group_batches(id),
  receiver_id  BIGINT NOT NULL,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  state        TEXT NOT NULL DEFAULT 'PENDING',
  txn_id       BIGINT REFERENCES ledger.transactions(id),
  error_reason TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT group_item_state_chk CHECK (state IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'))
);

CREATE INDEX IF NOT EXISTS group_batches_sender_idx ON ledger.group_batches (sender_id, id DESC);
CREATE INDEX IF NOT EXISTS group_items_batch_idx ON ledger.group_batch_items (batch_id, id);

-- 4. TOTP 2FA Authentication
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

-- 5. Grants & Permissions
GRANT USAGE ON SCHEMA ledger TO txn_svc, read_svc;
GRANT SELECT, INSERT, UPDATE ON
  ledger.recovery_cases,
  ledger.bill_payments,
  ledger.group_batches,
  ledger.group_batch_items
  TO txn_svc;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ledger TO txn_svc;

GRANT SELECT ON
  ledger.recovery_cases,
  ledger.bill_payments,
  ledger.group_batches,
  ledger.group_batch_items
  TO read_svc;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA auth TO auth_svc;
