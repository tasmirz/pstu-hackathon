# PSTU Hackathon — Money Movement App

**Services:** Auth Gateway · Txn Service · Read Service · Centrifugo · Redpanda · Postgres 16 + PgBouncer
**Ledger:** double-entry, append-only · **Money:** BIGINT paisa · **Writes:** synchronous · **Events:** outbox → Kafka

Contest window 09:00–15:00. Clock below starts 10:00; if 09:00–10:00 is usable it goes to **Phase 1 buffer**, not to extra features.

---

## Architecture

```
                         client
                            │
                  ┌─────────▼──────────┐
                  │   Auth Gateway     │  RS256 JWT, PIN, TOTP step-up,
                  │   schema: auth     │  rate limit, routing
                  └─────────┬──────────┘
              ┌─────────────┴──────────────┐
              │ sync (money)               │ sync (queries)
     ┌────────▼─────────┐         ┌────────▼─────────┐
     │  Txn Service     │         │  Read Service    │
     │  schema: ledger  │         │  SELECT-only     │
     │  WRITE model     │         │  READ model      │
     └────────┬─────────┘         └────────┬─────────┘
              │                            │
              │ ONE transaction:           │ getBalance  → primary
              │ txn + entries +            │ getHistory  → replica seam
              │ balances + outbox          │
              ▼                            ▼
       ┌──────────────────────────────────────────┐
       │      Postgres 16   (via PgBouncer)       │
       │      schemas: auth · ledger              │
       └──────────────────┬───────────────────────┘
                          │ outbox relay (SKIP LOCKED)
                          ▼
                  ┌───────────────┐
                  │   Redpanda    │  txn.completed · txn.reversed · notify
                  └───────┬───────┘
                          ▼
                  ┌───────────────┐
                  │  Centrifugo   │──── WS ────▶ recipient's browser
                  └───────────────┘
```

### The two decisions that define this design

**1. Money commands are synchronous. Money facts are asynchronous.**

A transfer is one HTTP call that returns a committed result — the new balance, or `InsufficientFunds`. It is never queued. Everything *downstream* of the commit (notifications, fraud scoring, statements, the WS push) rides Kafka off the outbox.

> *"We don't put money commands on a queue. We put money facts on a queue. When we answer you, the transfer is committed and durable, or it never happened."*

This is why the write path is not behind Kafka: an async write can't tell the user whether they have the funds, forces a pending-state UI, and makes command replay a double-spend risk. Queuing buys burst absorption, which PgBouncer already gives us on the connection side.

**2. This is CQRS, not a saga. Say it that way.**

There is no cross-service flow that can fail midway and needs compensating. Calling it a saga invites a question we'd lose. The correct name is **"an event-driven state machine with a transactional outbox."** The saga appears only past a single primary — see *Scaling* at the bottom — and saying *that* is the stronger answer.

### Why the outbox table stays

You cannot atomically commit to Postgres and publish to Kafka. "Publish right after commit" leaves a window where the transfer is durable but the event is lost forever — the read side and the recipient's notification silently never happen. The outbox row commits **in the same transaction as the money**; a relay drains it. It is also the answer to *"what if Redpanda dies?"* — transfers keep committing, events drain on recovery.

### No projection, no cache

The Read Service queries the same Postgres with **SELECT-only grants** — the ownership boundary is enforced by database permissions, not convention. We deliberately did not build a separate projection store.

> *"Read and write are separate services on separate scaling curves. Here the read model and write model are the same shape — a projection earns its cost when they diverge, like a feed joining transfers to counterparty names. The events are already flowing for it; that's where it plugs in."*

If a cache is added later: **invalidate, never update.** A consumer that `DEL`s a key degrades to one extra DB read on any lost/duplicate/out-of-order event. A consumer that writes values into the cache inherits duplicate-apply and cross-partition ordering bugs, and can hold a confidently wrong balance. Never cache the balance — it's a primary-key lookup already in `shared_buffers`, with the highest write rate and the highest correctness requirement in the system.

---

## Phase 0 — 10:00–10:25 · Setup (hard stop)

**`docker compose pull` at 10:00, before anything else.** Six images on venue wifi is the #1 way to lose 20 minutes.

- Repo created, first commit **pushed**
- `API.md` written so frontend isn't blocked
- `openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem`
- Roles:
  - **A** — Txn Service. Owns the ledger and the transfer path *alone*.
  - **B** — Auth Gateway, then features on top of A's ledger.
  - **C** — infra, migrations, seeds, outbox relay, Centrifugo, load test, README.
  - **D** — frontend against `API.md` mocks; wires Centrifugo last.

```yaml
volumes:
  pgdata:            # NAMED VOLUME. Never bind-mount pgdata to D:\ on Windows —
                     # fsync through Docker Desktop/WSL2 onto the Windows FS is a
                     # perf cliff, and we run synchronous_commit=on deliberately.
services:
  postgres:
    image: postgres:16
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    ports: [ "5432:5432" ]          # migrations connect HERE, direct
    command: >
      postgres
        -c shared_buffers=2GB       # postmaster-context: ALTER SYSTEM + reload
        -c max_wal_size=4GB         # would NOT apply it. Set it here.
        -c wal_compression=on
        -c synchronous_commit=on
        -c commit_delay=2000        # MICROseconds = 2ms. A bet on group commit.
        -c commit_siblings=5        # MEASURE IT ON/OFF. Quote the real number.
  pgbouncer:  { ports: ["6432:6432"] }   # apps connect here
  redpanda:   { }                        # 12 partitions per topic — see Scaling
  centrifugo: { ports: ["8000:8000"] }
```

```ini
# pgbouncer.ini
pool_mode = transaction
max_client_conn = 10000
default_pool_size = 50
```

### Three database roles — the guarantees depend on this

`REVOKE` from a role that **owns** the table is meaningless. Migrations run as the owner; services connect as lower-privileged roles. This is also what makes "the Read Service cannot write" a fact rather than a claim.

```sql
CREATE ROLE txn_svc  LOGIN PASSWORD '...';
CREATE ROLE read_svc LOGIN PASSWORD '...';

GRANT USAGE ON SCHEMA ledger TO txn_svc, read_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ledger TO txn_svc;

GRANT SELECT, INSERT, UPDATE ON ledger.accounts, ledger.transactions,
                                ledger.idempotency_keys, ledger.outbox TO txn_svc;
-- entries: INSERT + SELECT only. No UPDATE. No DELETE. Ever.
GRANT SELECT, INSERT ON ledger.entries TO txn_svc;

-- Read Service is structurally incapable of writing.
GRANT SELECT ON ALL TABLES IN SCHEMA ledger TO read_svc;
```

**Migrations connect to :5432 directly, never through PgBouncer** — most migration tools take a *session*-level advisory lock, which breaks under transaction pooling.

### Driver rules (non-negotiable)

```ts
import { types } from 'pg';
types.setTypeParser(20, (v: string) => parseInt(v, 10));   // int8 → number
```

Without this, `pg` returns every BIGINT as a **string**: `balance - amount` → `NaN`, `balance + amount` → string concatenation. Silent money corruption, and the first thing that will bite you. `parseInt` is safe here — max paisa is 9.007e15 (≈ ৳90 trillion). Do **not** use `BigInt`: `JSON.stringify` throws on it and takes down every serializer at once.

**No ORM on the PgBouncer connection.** Raw parameterized `pg` / `pg-promise` only. Prisma and TypeORM issue server-side prepared statements that break under `pool_mode = transaction`. LISTEN/NOTIFY is also unavailable — the outbox relay polls with `SKIP LOCKED`, which is what we want anyway.

No architecture talk after 10:25.

---

## Phase 1 — 10:25–12:00 · Ledger core (A) + minimal auth (B)

```sql
-- ============ schema: auth ============
CREATE TABLE auth.users (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,                  -- bcrypt cost 10 (cost 12 ≈ 250ms,
  totp_secret TEXT,                        --   would dominate the load test)
  status TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | FROZEN
  failed_pin_attempts INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ,
  token_version INT NOT NULL DEFAULT 0,    -- bump to revoke every session
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.refresh_tokens (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES auth.users(id),
  token_hash TEXT NOT NULL,                -- hashed, never raw
  family_id TEXT NOT NULL,                 -- reuse of a consumed token → revoke family
  consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ schema: ledger ============
CREATE TABLE ledger.accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,                          -- logical FK to auth.users, no cross-schema FK
  type TEXT NOT NULL,                      -- USER | SYSTEM_MINT | HOLD
  balance BIGINT NOT NULL DEFAULT 0,       -- CACHE of the ledger, never the truth
  CONSTRAINT non_negative CHECK (type = 'SYSTEM_MINT' OR balance >= 0)
);
-- HOLD is PER USER. A single shared HOLD row would be FOR UPDATE-locked by every
-- held transfer and would serialise the entire load test.
CREATE UNIQUE INDEX ON ledger.accounts (user_id, type) WHERE user_id IS NOT NULL;

CREATE TABLE ledger.transactions (
  id BIGSERIAL PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,                -- 'TXN_' || ULID, generated in app
  kind TEXT NOT NULL,   -- TRANSFER | REQUEST_SETTLE | REVERSAL | REFUND | SIGNUP_BONUS
  state TEXT NOT NULL,  -- PENDING | HELD | COMPLETED | CANCELLED | FAILED | REVERSED
  sender_id BIGINT, receiver_id BIGINT,
  amount BIGINT NOT NULL CHECK (amount > 0), note TEXT,
  reverses_txn_id BIGINT REFERENCES ledger.transactions(id),
  settle_after TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A transaction can be reversed exactly once. Enforced by the DB, not by app code.
CREATE UNIQUE INDEX one_reversal_per_txn
  ON ledger.transactions (reverses_txn_id) WHERE kind = 'REVERSAL';

CREATE TABLE ledger.entries (
  id BIGSERIAL PRIMARY KEY,
  txn_id BIGINT NOT NULL REFERENCES ledger.transactions(id),
  account_id BIGINT NOT NULL REFERENCES ledger.accounts(id),
  amount BIGINT NOT NULL,                  -- signed; negative = debit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- MANDATORY: the deferred trigger below runs SUM(...) WHERE txn_id = ? once PER LEG.
-- Without this index that is a seq scan on every insert and the load test dies.
CREATE INDEX ON ledger.entries (txn_id);
CREATE INDEX ON ledger.entries (account_id, created_at DESC);

-- (user_id, key), NOT a global key: a globally-unique key lets user A replay user B's
-- cached response by guessing it. That is a data leak, not a collision.
CREATE TABLE ledger.idempotency_keys (
  user_id BIGINT NOT NULL, key TEXT NOT NULL,
  request_hash TEXT NOT NULL, response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE ledger.money_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT NOT NULL, payer_id BIGINT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0), note TEXT,
  state TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING|PAID|DECLINED|EXPIRED|CANCELLED
  expires_at TIMESTAMPTZ, settled_txn_id BIGINT REFERENCES ledger.transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ledger.money_requests (payer_id, id DESC) WHERE state = 'PENDING';

CREATE TABLE ledger.outbox (
  id BIGSERIAL PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0
);
CREATE INDEX ON ledger.outbox (id) WHERE processed_at IS NULL;   -- partial

CREATE TABLE ledger.audit_log (
  id BIGSERIAL PRIMARY KEY, actor_id BIGINT, action TEXT,
  entity TEXT, entity_id BIGINT, before JSONB, after JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Not partitioning `entries`.** It costs a PK that must carry the partition key, a `DEFAULT` partition to avoid `no partition of relation found` mid-demo, and — the real reason — uncertainty about whether `CREATE CONSTRAINT TRIGGER` is accepted on a partitioned parent, which is a 20-minute unknown at 10:30 sitting under our centrepiece guarantee. The scale answer is verbal: *"range-partition by month with pruning; we didn't build it for a demo dataset."*

### The database enforces double-entry, not the service layer

```sql
CREATE OR REPLACE FUNCTION ledger.assert_balanced() RETURNS TRIGGER AS $$
DECLARE s BIGINT; n INT;
BEGIN
  SELECT COALESCE(SUM(amount),0), COUNT(*) INTO s, n
    FROM ledger.entries WHERE txn_id = NEW.txn_id;
  IF n < 2 THEN RAISE EXCEPTION 'txn % has only % leg(s)', NEW.txn_id, n; END IF;
  IF s <> 0 THEN RAISE EXCEPTION 'unbalanced txn %: sum=%', NEW.txn_id, s; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entries_balanced
  AFTER INSERT ON ledger.entries
  DEFERRABLE INITIALLY DEFERRED     -- fires at COMMIT, once all legs exist
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_balanced();
```

A zero-leg transaction never fires this trigger at all — it also moves no money, and `/admin/integrity` covers it. Prove the trigger live: insert one unbalanced leg, watch `COMMIT` reject it.

### Transfer — the whole money path, one transaction

```ts
async execute({ senderId, receiverId, amount, idemKey, note }) {
  const reqHash = hash({ senderId, receiverId, amount });

  return this.db.tx(async (t) => {
    const claimed = await t.query(
      `INSERT INTO ledger.idempotency_keys(user_id,key,request_hash) VALUES ($1,$2,$3)
       ON CONFLICT (user_id,key) DO NOTHING RETURNING key`,
      [senderId, idemKey, reqHash]);

    if (!claimed.rowCount) {
      // A concurrent duplicate blocks on the unique index until the first COMMIT,
      // so `response` is populated by the time we read it.
      const prior = await t.query(
        `SELECT request_hash, response FROM ledger.idempotency_keys
          WHERE user_id=$1 AND key=$2`, [senderId, idemKey]);
      // Same key, different payload = client bug or attack. Never replay it.
      if (prior.rows[0].request_hash !== reqHash) throw new IdempotencyKeyReuse();  // 422
      return prior.rows[0].response;                          // double-tap → one debit
    }

    // Ascending account id: two concurrent A↔B transfers can never deadlock.
    const ids = [senderAcc, receiverAcc].sort((a, b) => a - b);
    await t.query(`SELECT id,balance FROM ledger.accounts
                    WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [ids]);
    if (senderBalance < amount) throw new InsufficientFunds();

    const txn = await t.query(`INSERT INTO ledger.transactions(...) RETURNING *`);
    await t.query(`INSERT INTO ledger.entries(txn_id,account_id,amount)
                   VALUES ($1,$2,$3),($1,$4,$5)`,
                  [txn.id, senderAcc, -amount, receiverAcc, amount]);
    await t.query(`UPDATE ledger.accounts SET balance=balance-$1 WHERE id=$2`, [amount, senderAcc]);
    await t.query(`UPDATE ledger.accounts SET balance=balance+$1 WHERE id=$2`, [amount, receiverAcc]);
    await t.query(`INSERT INTO ledger.outbox(topic,payload) VALUES ('txn.completed',$1)`,
                  [JSON.stringify(txn)]);
    await t.query(`UPDATE ledger.idempotency_keys SET response=$1
                    WHERE user_id=$2 AND key=$3`, [JSON.stringify(txn), senderId, idemKey]);
    return txn;                                  // ← returned to the client, committed
  });
}
```

### Every state transition is an atomic CAS — never read-check-write

```sql
UPDATE ledger.transactions SET state='REVERSED'
 WHERE id=$1 AND state='COMPLETED' RETURNING *;
-- rowCount = 0 → someone already reversed/cancelled it. Abort, do not compensate.
```

Same for `HELD → COMPLETED` and `HELD → CANCELLED`. The conditional `UPDATE` *is* the lock; a `SELECT` then an `if` then an `UPDATE` is a double-spend waiting for two consumers.

### Read Service routing — the replica seam

```ts
class LedgerRepository {
  constructor(private primary: Pool, private replica: Pool) {}
  getBalance(userId) { return this.primary.query(...); }   // read-your-own-writes
  getHistory(userId) { return this.replica.query(...); }   // stale-tolerant, keyset paged
}
```

**Both pools point at the same DSN today.** We are not building streaming replication — it's 30 fiddly minutes, does nothing for a demo dataset, and its one visible effect on stage would be replica lag making the sender's balance look stale. *"The routing seam is in the repository; the replica is a connection string."* True, and stronger than a half-built replica.

**Signup** mints ৳100,000 from `SYSTEM_MINT`, which goes negative — correct, it *is* the money supply. The ledger still sums to zero.

**Auth:** phone + PIN (bcrypt cost 10) → RS256 JWT, 15-min access + rotating refresh stored hashed. Reuse of a consumed refresh token revokes the family. Lockout after 5 failed PINs — a 4-digit PIN is trivially brute-forced and judges will probe it. **No TOTP at login.**

### Checkpoint 12:00 — gate, not a suggestion

Two curl calls, same idempotency key → **one** debit. Same key, different amount → 422. One unbalanced leg → rejected at COMMIT. If this isn't green, cut features. Never cut this.

---

## Phase 2 — 12:00–13:00 · Features, Read Service, Centrifugo

Build in order. **Stop at the cut line when the clock says so, not when you feel behind.**

**Above the line:**
1. **Outbox relay** (C) — `SELECT ... WHERE processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100` → Redpanda. Many relays, no contention, no duplicates.
2. **Centrifugo** (C) — consume `txn.completed`, publish to the receiver's channel. Use the stock Redis-engine config; do not hand-roll WS.
   - **Per-user channel authorization is mandatory** — user A must not be able to subscribe to B's channel. Centrifugo's user-limited channel form (`ns:name#<userid>`) plus a JWT connection token is the shortest path; verify the exact syntax against the Centrifugo docs before wiring it.
3. **Recipient name confirmation** before send — typo protection.
4. **Duplicate-send guard** — *"you sent ৳500 to Rahim 90 seconds ago, send again?"*
5. **Money requests** — approve / decline / expire. **Never auto-debit.** Approval runs the ordinary transfer path with `kind='REQUEST_SETTLE'` and a CAS on the request's own state.
6. **Reversals** — never DELETE, never UPDATE. New txn, `kind='REVERSAL'`, `reverses_txn_id` set, mirrored entries, CAS from `COMPLETED`. Say **"compensating transaction."**
7. Self-transfer block, zero/negative rejection.

**Below the line — only if genuinely ahead:**
8. Daily limits + velocity check (>10 txn/min → PIN re-entry).
9. Freeze — frozen accounts receive but cannot send.
10. **60-second undo window** above ৳5,000. The design that is safe: **two separately balanced transactions** — `sender → HOLD(sender)` commits immediately (money can't be double-spent), then `HOLD(sender) → receiver` at settle, or `HOLD(sender) → sender` on cancel. Both transitions CAS off `HELD`. Plus a sweeper using `SKIP LOCKED`. It is the most human-centred feature available and directly answers the brief's *"people using the application"* half — but it is the first thing to lose to the clock.
11. **TOTP step-up.** Note the split before building it: the gateway can enforce **amount-threshold** step-up because it can see `amount`, but *"first-ever recipient"* is a ledger fact the gateway doesn't hold — that rule has to live in the Txn Service. Decide which rules ship; don't claim both.

---

## Phase 3 — 13:00–13:45 · Proof

This phase wins the judging. Protect it — it is worth more than anything below the Phase 2 cut line.

- **Load test:** 200 accounts, 5,000 concurrent transfers in a ring (i → i+1). Assert **total supply unchanged** and **no negative USER balance**. Run it live. *Write this script during Phase 1* — authoring a load generator at 13:00 is where this goes wrong.
- **Measure `commit_delay` on vs. off.** Print the TPS. Quote the measured number, never a round one.
- **Crash test:** kill the Txn Service mid-load, restart. Nothing lost, no partial transfers. Then kill **Redpanda** — transfers keep committing, outbox backs up, events drain on recovery. That second one is the whole architecture argument in fifteen seconds.
- **`/admin/integrity`** — live proof that `SUM(ledger.entries.amount) = 0`, every cached `accounts.balance` equals its ledger sum, and no USER account is negative.
- Keyset pagination everywhere (`WHERE id < $cursor`, never `OFFSET`).

---

## Phase 4 — 13:45–14:25 · UI (10% of marks)

Login → dashboard → send with confirm step → request inbox → history → **Ledger Integrity page**.

Two browser windows side by side: money leaves one, Centrifugo lands it live in the other. That's the best visual moment available — wire it even if something else is unfinished. Keep everything else plain.

---

## Phase 5 — 14:25–14:50 · Freeze

README with the architecture diagram and design decisions. Seeded demo accounts. **Rehearse twice.** Push at 14:50 and stop.

### Demo script — build backwards from this
1. Send ৳2,500 A → B. Recipient name confirmation. *(the brief's own words)*
2. Second window updates live over Centrifugo.
3. Double-tap send with the same idempotency key → **one** debit.
4. B requests ৳1,200 from A → A approves. *(the brief's other quote)*
5. Reverse a transaction — the ledger grew, nothing was edited.
6. Run the 5,000-transfer load test **live**. Total supply unchanged.
7. Kill Redpanda. Transfers still work.
8. Open `/admin/integrity`. Sum = 0.

---

## Scaling — the million-user answer

Give it as a bottleneck ladder, in the order you'd actually hit them:

| Wall | Fix | Built? |
|---|---|---|
| Connections (10k clients) | PgBouncer, transaction mode | ✅ |
| Fan-out work (notify, fraud, statements) | Outbox → Kafka → consumers | ✅ |
| Read throughput | Replicas + repository routing seam | seam ✅, replica no |
| **Write throughput, single primary** | ← **the real wall** | measured |
| Hot-account contention | Shard `SYSTEM_MINT` into N; sub-accounts for hot merchants | designed |
| Beyond one primary | Shard by `user_id`; cross-shard transfers go two-phase | design only |

Two things make this better than every other team's answer:

**Name the actual wall.** Scaling Txn Service instances buys nothing past the primary's commit ceiling — it just moves the queue. One primary with `synchronous_commit=on` lands in the low thousands of write transactions/sec and a transfer is ~6 row writes, so the ceiling is order-of-magnitude 1–3k transfers/sec. The load test gives you the real figure; *"we measured 1,840/s on a laptop"* beats any confident round number.

**Name the contention, not just the throughput.** What bites first isn't total TPS — it's one hot row serializing on `FOR UPDATE`. Knowing the bottleneck is lock contention on specific accounts, rather than "we need more servers," is the difference between reading about scale and understanding it.

**And that's where the saga finally earns its name:** sharding by user means a cross-shard transfer can't be one transaction, so it becomes a genuine two-phase compensating flow. *"We didn't build it because it's the wrong complexity at our stage — but the ledger is already append-only and idempotent, which is what makes it possible."*

One number to fix now: **give Redpanda 12–24 partitions per topic even with one consumer.** Partition count is the consumer-concurrency ceiling, and repartitioning later breaks ordering. It's the one setting here that's expensive to change.

---

## SOLID

- **S** — controller does HTTP, service does rules, repository does SQL.
- **O** — `TransferStrategy`: `P2PTransfer`, `RequestSettlement`, `Reversal`, `Refund`. New type = one new class, zero edits. Literally the "new features with less effort" criterion.
- **L** — every strategy honours the same contract; the executor swaps them blindly.
- **I** — `BalanceReader` and `LedgerWriter` are separate; reads don't inherit write methods.
- **D** — repositories injected as interfaces. It's how primary/replica routing exists without business logic knowing.

In the code: Repository, Strategy, State Machine, Transactional Outbox, CQRS, Factory, Middleware/Decorator.

---

## Answers to have loaded

| They ask | You say |
|---|---|
| Why isn't the write path on Kafka? | We don't queue money commands, we queue money facts. When we answer you, it's committed or it never happened. |
| Why not a separate projection DB? | Read and write models are the same shape here. A projection earns its cost when they diverge; the events are already flowing for it. |
| Is this a saga? | No — it's an event-driven state machine with a transactional outbox. The saga appears when we shard past one primary. |
| Why keep an outbox if you have Kafka? | You can't atomically commit to Postgres and publish to Kafka. Without the outbox, a crash between the two loses the event forever. |
| Where's the truth? | `ledger.entries`. `accounts.balance` is a cache, and `/admin/integrity` proves they agree. |
| Someone taps send twice? | Idempotency key scoped per user. Same payload replays the response; different payload is rejected 422. |
| Deadlocks? | Locks always acquired in ascending account id. Two concurrent A↔B transfers cannot deadlock. |
| What if Redpanda dies? | Transfers keep committing. The outbox backs up and drains on recovery. We'll show you. |
| Why `synchronous_commit = on`? | It's money. We'd rather be slower than lose a committed transfer — and we measured the cost. |
| How do you know it's correct under load? | We don't assert it, we test it. 5,000 concurrent transfers, supply unchanged, live. |
