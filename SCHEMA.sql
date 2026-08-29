-- =====================================================================
--  PSTU Hackathon — Money Movement App
--  Complete schema. Run as the OWNER role, directly against :5432
--  (NEVER through PgBouncer — migration tools take session-level
--   advisory locks, which break under pool_mode = transaction).
--
--  Money is BIGINT paisa everywhere. No NUMERIC, no FLOAT, no exceptions.
--  ৳1.00 = 100 paisa.  ৳100,000.00 = 10_000_000 paisa.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS notify;

-- =====================================================================
--  SCHEMA: auth   — owned by Auth Gateway
-- =====================================================================

CREATE TABLE auth.users (
  id                  BIGSERIAL PRIMARY KEY,
  phone               TEXT        NOT NULL UNIQUE,
  name                TEXT        NOT NULL,
  pin_hash            TEXT        NOT NULL,          -- bcrypt, cost 10
  totp_secret         TEXT,                          -- base32; NULL until enrolled
  totp_enrolled_at    TIMESTAMPTZ,
  status              TEXT        NOT NULL DEFAULT 'ACTIVE',
  failed_pin_attempts INT         NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,                   -- set after 5 failures
  token_version       INT         NOT NULL DEFAULT 0,-- bump = revoke every session
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_status_chk CHECK (status IN ('ACTIVE','FROZEN'))
);

CREATE INDEX ON auth.users (phone);

-- Rotating refresh tokens. Reuse of a CONSUMED token means the token was
-- stolen and replayed -> revoke the whole family, not just that token.
CREATE TABLE auth.refresh_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,           -- sha256 of the raw token
  family_id   UUID        NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON auth.refresh_tokens (user_id);
CREATE INDEX ON auth.refresh_tokens (family_id);

-- 8 single-use codes, stored hashed. Same treatment as a password.
CREATE TABLE auth.totp_backup_codes (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT        NOT NULL,
  used_at   TIMESTAMPTZ
);

CREATE INDEX ON auth.totp_backup_codes (user_id) WHERE used_at IS NULL;

-- A TOTP code is valid for a 30s window. Without this table the SAME code can
-- be replayed inside its own window. One row per (user, time-step) consumed.
CREATE TABLE auth.totp_used_steps (
  user_id   BIGINT      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  time_step BIGINT      NOT NULL,
  used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, time_step)
);

-- =====================================================================
--  SCHEMA: ledger   — owned by Txn Service. The source of truth.
-- =====================================================================

CREATE TABLE ledger.accounts (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,                                 -- logical FK to auth.users;
                                                     -- no cross-schema FK by design
  type       TEXT        NOT NULL,
  balance    BIGINT      NOT NULL DEFAULT 0,         -- CACHE of the ledger.
                                                     -- SUM(entries) is the truth.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT accounts_type_chk
    CHECK (type IN ('USER','SYSTEM_MINT','HOLD','ESCROW')),

  -- SYSTEM_MINT is the money supply and is SUPPOSED to go negative.
  -- Everything else — including HOLD and ESCROW — must never go below zero.
  -- This is what catches a double-settle of a held transfer at the DB level.
  CONSTRAINT accounts_non_negative
    CHECK (type = 'SYSTEM_MINT' OR balance >= 0)
);

-- HOLD and ESCROW are PER USER, never global. A single shared HOLD row would be
-- FOR UPDATE-locked by every held transfer in the system and would serialise
-- the entire write path.
CREATE UNIQUE INDEX accounts_one_per_user_type
  ON ledger.accounts (user_id, type) WHERE user_id IS NOT NULL;

CREATE INDEX ON ledger.accounts (user_id);


CREATE TABLE ledger.transactions (
  id              BIGSERIAL PRIMARY KEY,
  ref             TEXT        NOT NULL UNIQUE,       -- 'TXN_' || ULID, app-generated
  kind            TEXT        NOT NULL,
  state           TEXT        NOT NULL,
  sender_id       BIGINT,                            -- auth.users.id (logical)
  receiver_id     BIGINT,
  amount          BIGINT      NOT NULL CHECK (amount > 0),   -- paisa
  note            TEXT,

  reverses_txn_id BIGINT REFERENCES ledger.transactions(id), -- REVERSAL -> original
  parent_txn_id   BIGINT REFERENCES ledger.transactions(id), -- HOLD_SETTLE/CANCEL
                                                             --   -> the HELD transfer
  settle_after    TIMESTAMPTZ,                       -- undo window deadline
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT txn_kind_chk CHECK (kind IN (
    'SIGNUP_BONUS','TRANSFER','REQUEST_SETTLE','SPLIT',
    'HOLD_SETTLE','HOLD_CANCEL','REVERSAL','REFUND',
    'ESCROW_PLACE','ESCROW_CLAIM','ESCROW_REFUND')),

  CONSTRAINT txn_state_chk CHECK (state IN (
    'PENDING','HELD','COMPLETED','CANCELLED','FAILED','REVERSED'))
);

-- A transaction can be reversed EXACTLY ONCE. Enforced by the database,
-- not by an application if-statement that two workers can both pass.
CREATE UNIQUE INDEX one_reversal_per_txn
  ON ledger.transactions (reverses_txn_id) WHERE kind = 'REVERSAL';

-- Likewise: a HELD transfer resolves exactly once, settle or cancel, never both.
CREATE UNIQUE INDEX one_resolution_per_hold
  ON ledger.transactions (parent_txn_id)
  WHERE kind IN ('HOLD_SETTLE','HOLD_CANCEL');

CREATE INDEX ON ledger.transactions (sender_id,   id DESC);
CREATE INDEX ON ledger.transactions (receiver_id, id DESC);
CREATE INDEX ON ledger.transactions (state, settle_after)
  WHERE state IN ('HELD','PENDING');                 -- the sweeper's index
CREATE INDEX ON ledger.transactions (created_at DESC);


-- ---------------------------------------------------------------------
--  ledger.entries — APPEND ONLY. The truth.
--  Partitioned by month: at 10M users this is 7B+ rows/yr, and archiving
--  an old month becomes a metadata operation (DETACH) instead of a DELETE
--  that rewrites the table.
-- ---------------------------------------------------------------------
CREATE TABLE ledger.entries (
  id         BIGSERIAL,
  txn_id     BIGINT      NOT NULL,
  account_id BIGINT      NOT NULL,
  amount     BIGINT      NOT NULL,       -- SIGNED. negative = debit, positive = credit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)           -- a partitioned table's PK must contain
) PARTITION BY RANGE (created_at);       -- the partition key

CREATE TABLE ledger.entries_2026_08 PARTITION OF ledger.entries
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE ledger.entries_2026_09 PARTITION OF ledger.entries
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- Without a DEFAULT partition, ONE row with an unexpected created_at — a bad
-- seed, clock skew, a demo running past midnight — throws
-- "no partition of relation found" in the middle of the demo.
CREATE TABLE ledger.entries_default PARTITION OF ledger.entries DEFAULT;

-- MANDATORY. assert_balanced() below runs SUM(...) WHERE txn_id = ? once PER LEG
-- at every COMMIT. Without this index that is a sequential scan on every insert
-- and the load test collapses.
CREATE INDEX ON ledger.entries (txn_id);
CREATE INDEX ON ledger.entries (account_id, created_at DESC);


-- ---------------------------------------------------------------------
--  The database enforces double-entry. Not the service layer.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.assert_balanced() RETURNS TRIGGER AS $$
DECLARE s BIGINT; n INT;
BEGIN
  SELECT COALESCE(SUM(amount),0), COUNT(*) INTO s, n
    FROM ledger.entries WHERE txn_id = NEW.txn_id;

  IF n < 2 THEN
    RAISE EXCEPTION 'txn % has only % leg(s); double-entry needs >= 2', NEW.txn_id, n;
  END IF;
  IF s <> 0 THEN
    RAISE EXCEPTION 'unbalanced txn %: legs sum to % paisa, must be 0', NEW.txn_id, s;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- Attach the constraint trigger to EVERY PARTITION rather than the parent.
-- Whether a partitioned parent accepts CREATE CONSTRAINT TRIGGER varies; a
-- partition is an ordinary table and always does. Routed inserts fire the
-- partition's own row triggers, so behaviour is identical and deterministic.
CREATE OR REPLACE FUNCTION ledger.attach_balance_trigger(part regclass) RETURNS void AS $$
BEGIN
  EXECUTE format(
    'CREATE CONSTRAINT TRIGGER entries_balanced
       AFTER INSERT ON %s
       DEFERRABLE INITIALLY DEFERRED       -- fires at COMMIT, once all legs exist
       FOR EACH ROW EXECUTE FUNCTION ledger.assert_balanced()', part);
END $$ LANGUAGE plpgsql;

DO $$ DECLARE p regclass;
BEGIN
  FOR p IN SELECT inhrelid::regclass FROM pg_inherits
            WHERE inhparent = 'ledger.entries'::regclass
  LOOP PERFORM ledger.attach_balance_trigger(p); END LOOP;
END $$;

-- Roll a new month forward. Call this from the partition-management endpoint.
-- The trigger attach is NOT optional — a partition without it is a hole in the
-- guarantee that nothing else will catch.
CREATE OR REPLACE FUNCTION ledger.create_month_partition(month_start DATE) RETURNS void AS $$
DECLARE part_name TEXT;
BEGIN
  part_name := 'entries_' || to_char(month_start, 'YYYY_MM');
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS ledger.%I PARTITION OF ledger.entries
       FOR VALUES FROM (%L) TO (%L)',
    part_name, month_start, month_start + INTERVAL '1 month');
  PERFORM ledger.attach_balance_trigger(format('ledger.%I', part_name)::regclass);
END $$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
--  Idempotency
--  PK is (user_id, key), NOT key alone. A globally-unique key lets user A
--  replay user B's cached response by guessing it — that is a data leak,
--  not merely a collision.
-- ---------------------------------------------------------------------
CREATE TABLE ledger.idempotency_keys (
  user_id      BIGINT      NOT NULL,
  key          TEXT        NOT NULL,
  request_hash TEXT        NOT NULL,     -- sha256 of the normalised request body
  response     JSONB,                    -- written before COMMIT, replayed verbatim
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX ON ledger.idempotency_keys (created_at);   -- for TTL cleanup


CREATE TABLE ledger.money_requests (
  id             BIGSERIAL PRIMARY KEY,
  requester_id   BIGINT      NOT NULL,
  payer_id       BIGINT      NOT NULL,
  amount         BIGINT      NOT NULL CHECK (amount > 0),
  note           TEXT,
  state          TEXT        NOT NULL DEFAULT 'PENDING',
  expires_at     TIMESTAMPTZ NOT NULL,
  settled_txn_id BIGINT REFERENCES ledger.transactions(id),
  reminded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mr_state_chk
    CHECK (state IN ('PENDING','PAID','DECLINED','EXPIRED','CANCELLED')),
  CONSTRAINT mr_not_self CHECK (requester_id <> payer_id)
);

CREATE INDEX ON ledger.money_requests (payer_id,     id DESC) WHERE state = 'PENDING';
CREATE INDEX ON ledger.money_requests (requester_id, id DESC);
CREATE INDEX ON ledger.money_requests (expires_at)           WHERE state = 'PENDING';


CREATE TABLE ledger.disputes (
  id             BIGSERIAL PRIMARY KEY,
  txn_id         BIGINT      NOT NULL REFERENCES ledger.transactions(id),
  raised_by      BIGINT      NOT NULL,
  reason         TEXT        NOT NULL,
  state          TEXT        NOT NULL DEFAULT 'OPEN',
  resolution     TEXT,                                -- admin's mandatory note
  resolved_by    BIGINT,
  reversal_txn_id BIGINT REFERENCES ledger.transactions(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,

  CONSTRAINT dispute_state_chk CHECK (state IN ('OPEN','REVERSED','REJECTED'))
);

CREATE UNIQUE INDEX one_open_dispute_per_txn
  ON ledger.disputes (txn_id) WHERE state = 'OPEN';
CREATE INDEX ON ledger.disputes (state, id DESC);


-- Per-user daily send cap. Absence of a row means the system default applies.
CREATE TABLE ledger.limit_overrides (
  user_id          BIGINT PRIMARY KEY,
  daily_send_limit BIGINT NOT NULL CHECK (daily_send_limit >= 0),
  set_by           BIGINT NOT NULL,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
--  Transactional outbox
--  You cannot atomically COMMIT to Postgres and publish to Kafka. This row
--  commits in the SAME transaction as the money; a relay drains it afterwards.
--  Delete this table and a crash between commit and publish loses the event
--  permanently — the read side and the recipient's notification never happen.
-- ---------------------------------------------------------------------
CREATE TABLE ledger.outbox (
  id           BIGSERIAL PRIMARY KEY,
  topic        TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  processed_at TIMESTAMPTZ,
  attempts     INT         NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: the relay only ever scans unprocessed rows, so the index
-- stays small no matter how large the table grows.
CREATE INDEX outbox_unprocessed ON ledger.outbox (id) WHERE processed_at IS NULL;
CREATE INDEX outbox_dead_letter ON ledger.outbox (attempts)
  WHERE processed_at IS NULL AND attempts >= 5;


CREATE TABLE ledger.audit_log (
  id        BIGSERIAL PRIMARY KEY,
  actor_id  BIGINT,
  actor_kind TEXT NOT NULL DEFAULT 'USER',           -- USER | ADMIN | SYSTEM
  action    TEXT        NOT NULL,
  entity    TEXT,
  entity_id BIGINT,
  before    JSONB,
  after     JSONB,
  ip        INET,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON ledger.audit_log (entity, entity_id, id DESC);
CREATE INDEX ON ledger.audit_log (actor_id, id DESC);
CREATE INDEX ON ledger.audit_log (at DESC);


-- ---------------------------------------------------------------------
--  Tamper-evidence, computed ASYNCHRONOUSLY.
--  A prev_hash column on entries would force every insert to read the previous
--  row's hash — a global serialisation point that destroys write throughput.
--  Instead a verifier walks the append-only log in id order out-of-band and
--  checkpoints a rolling hash. Same tamper detection, zero write-path cost.
-- ---------------------------------------------------------------------
CREATE TABLE ledger.chain_checkpoints (
  id             BIGSERIAL PRIMARY KEY,
  up_to_entry_id BIGINT      NOT NULL,
  rolling_hash   TEXT        NOT NULL,   -- sha256(prev_hash || id|txn|acct|amt)
  entry_count    BIGINT      NOT NULL,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =====================================================================
--  SCHEMA: notify   — owned by Read Service (it also runs the consumer)
-- =====================================================================

CREATE TABLE notify.notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL,
  kind       TEXT        NOT NULL,       -- TXN_RECEIVED | TXN_SENT | REQUEST_NEW |
                                         -- REQUEST_PAID | REVERSAL | LIMIT_WARNING
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  txn_id     BIGINT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON notify.notifications (user_id, id DESC);
CREATE INDEX ON notify.notifications (user_id) WHERE read_at IS NULL;

-- Kafka is at-least-once: every event arrives at least twice on some crash path.
-- This table is what stops a redelivery from creating a duplicate notification.
CREATE TABLE notify.processed_events (
  event_id     TEXT PRIMARY KEY,          -- outbox.id, carried in the message
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =====================================================================
--  ROLES — the guarantees above are only real if the app cannot bypass them.
--  REVOKE from a role that OWNS the table is meaningless: an owner re-grants
--  at will. Migrations run as the owner; services connect as these roles.
-- =====================================================================

CREATE ROLE auth_svc LOGIN PASSWORD 'changeme_auth';
CREATE ROLE txn_svc  LOGIN PASSWORD 'changeme_txn';
CREATE ROLE read_svc LOGIN PASSWORD 'changeme_read';

GRANT USAGE ON SCHEMA auth   TO auth_svc;
GRANT USAGE ON SCHEMA ledger TO txn_svc, read_svc;
GRANT USAGE ON SCHEMA notify TO read_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA auth   TO auth_svc;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA auth   TO auth_svc;

GRANT SELECT, INSERT, UPDATE ON
  ledger.accounts, ledger.transactions, ledger.idempotency_keys,
  ledger.money_requests, ledger.disputes, ledger.limit_overrides,
  ledger.outbox, ledger.chain_checkpoints
  TO txn_svc;
GRANT SELECT, INSERT ON ledger.audit_log TO txn_svc;

-- entries: INSERT and SELECT only. No UPDATE. No DELETE. Ever.
-- Append-only is enforced by permission, not by convention.
GRANT SELECT, INSERT ON ledger.entries TO txn_svc;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ledger TO txn_svc;  -- covers partitions
REVOKE UPDATE, DELETE ON ledger.entries FROM txn_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ledger TO txn_svc;

-- The Read Service is STRUCTURALLY incapable of writing to the ledger.
-- This is what makes "no service writes another service's tables" a fact.
GRANT SELECT ON ALL TABLES IN SCHEMA ledger TO read_svc;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES    IN SCHEMA notify TO read_svc;
GRANT USAGE, SELECT          ON ALL SEQUENCES IN SCHEMA notify TO read_svc;


-- =====================================================================
--  SEED — the money supply
-- =====================================================================

INSERT INTO ledger.accounts (user_id, type, balance) VALUES (NULL, 'SYSTEM_MINT', 0);
-- Every signup debits this account by ৳100,000 (10_000_000 paisa) as a real
-- double-entry transaction. It goes deeply negative, which is CORRECT — it is
-- the money supply. SUM(entries) across the whole ledger stays exactly 0.


-- =====================================================================
--  INTEGRITY — what GET /admin/integrity runs. Also the load test's assertion.
-- =====================================================================

-- 1. Global conservation. Must be 0. Always. No exceptions.
CREATE OR REPLACE VIEW ledger.v_conservation AS
  SELECT COALESCE(SUM(amount), 0) AS total_paisa FROM ledger.entries;

-- 2. Every cached balance must equal its ledger-derived balance.
CREATE OR REPLACE VIEW ledger.v_balance_drift AS
  SELECT a.id AS account_id, a.user_id, a.type,
         a.balance                      AS cached_paisa,
         COALESCE(SUM(e.amount), 0)     AS derived_paisa,
         a.balance - COALESCE(SUM(e.amount), 0) AS drift_paisa
    FROM ledger.accounts a
    LEFT JOIN ledger.entries e ON e.account_id = a.id
   GROUP BY a.id, a.user_id, a.type, a.balance
  HAVING a.balance <> COALESCE(SUM(e.amount), 0);

-- 3. No USER/HOLD/ESCROW account may be negative.
CREATE OR REPLACE VIEW ledger.v_negative_accounts AS
  SELECT id AS account_id, user_id, type, balance
    FROM ledger.accounts
   WHERE type <> 'SYSTEM_MINT' AND balance < 0;

-- Rebuild one account's cached balance from the ledger. Recovery you can
-- actually run on stage, not a claim in a README.
CREATE OR REPLACE FUNCTION ledger.rebuild_balance(p_account_id BIGINT)
RETURNS BIGINT AS $$
DECLARE derived BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO derived
    FROM ledger.entries WHERE account_id = p_account_id;
  UPDATE ledger.accounts SET balance = derived WHERE id = p_account_id;
  RETURN derived;
END $$ LANGUAGE plpgsql;
