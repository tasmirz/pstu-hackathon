# PSTU Hackathon — Money Movement App

**Services:** Auth Gateway · Txn Service · Read Service · Centrifugo · Redpanda · Redis · Postgres 16 + PgBouncer
**Ledger:** double-entry, append-only, partitioned · **Money:** BIGINT paisa · **Writes:** synchronous · **Events:** outbox → Kafka

| File | What it is | Owner |
|---|---|---|
| `PLAN.md` | This file — architecture, schedule, priorities, defense | everyone |
| `SCHEMA.sql` | Complete runnable schema, roles, integrity views | C |
| `API.md` | Every endpoint, request/response shape, error code | B, D |
| `UI_SPEC.md` | Every screen, state, and interaction | D |
| `SIMULATOR.md` | Scenario harness: every failure mode, PASS/FAIL board | C |

Contest window **09:00–15:00**. The clock below starts at 10:00. If 09:00–10:00 turns out to be usable, that hour goes to **Phase 1 buffer** — not to extra features. Phase 1 running long is the single most likely way this day goes wrong, and an hour of slack there is worth more than any P1 feature.

---

# 1. Architecture

```
                                 client
                                    │
                        ┌───────────▼────────────┐
                        │     Auth Gateway       │   RS256 JWT · PIN · TOTP step-up
                        │     schema: auth       │   rate limit · routing
                        └───────────┬────────────┘
                    ┌───────────────┴────────────────┐
                    │ sync (money)                   │ sync (queries)
         ┌──────────▼───────────┐          ┌─────────▼────────────┐     ┌───────┐
         │     Txn Service      │          │     Read Service     │◀───▶│ Redis │
         │     schema: ledger   │          │  SELECT-only on      │     │ cache │
         │     WRITE model      │          │  ledger; owns notify │     └───────┘
         └──────────┬───────────┘          └─────────┬────────────┘   version-keyed
                    │                                │
                    │  ONE transaction:              │  getBalance → primary
                    │  txn + entries + balances      │  getHistory → replica seam
                    │  + outbox, all-or-nothing      │
                    ▼                                ▼
         ┌────────────────────────────────────────────────────┐
         │        Postgres 16          (apps via PgBouncer)   │
         │        schemas: auth · ledger · notify             │
         └────────────────────────┬───────────────────────────┘
                                  │ outbox relay — FOR UPDATE SKIP LOCKED
                                  ▼
                        ┌──────────────────┐
                        │    Redpanda      │  txn.completed · txn.reversed
                        │  12–24 partitions│  txn.held · request.* · fraud.*
                        └────────┬─────────┘
                     ┌───────────┴────────────┐
                     ▼                        ▼
            ┌────────────────┐      ┌──────────────────────────────┐
            │  Centrifugo    │      │  consumer (in Read Svc)      │
            │  WS fan-out    │      │  writes notifications        │
            └───────┬────────┘      │  INCRs Redis cache version   │
                    │               └──────────────────────────────┘
                    │ WS
                    ▼
            recipient's browser — balance updates live
```

## 1.1 The three decisions that define this system

### Decision 1 — Money commands are synchronous. Money facts are asynchronous.

A transfer is **one HTTP call that returns a committed result**: the new balance, or `INSUFFICIENT_FUNDS`. It is never queued. Everything downstream of the commit — notifications, fraud scoring, statements, the websocket push — rides Kafka off the transactional outbox.

We considered putting the write path behind Kafka (client → gateway → Kafka → txn service) and rejected it for four concrete reasons:

1. **The user would never learn whether their transfer worked.** The gateway would return `202 Accepted` with no result. Insufficient funds becomes an *asynchronous error* arriving over a websocket 300ms later. For an application whose brief is *"correct, reliable and trustworthy"*, "I pressed send and I don't know what happened" is the exact failure being tested.
2. **It forces a pending-state UI**, plus a status-polling endpoint for when the socket is down, plus reconnect handling — all landing in Phase 4 where there is least time.
3. **Command replay double-spends.** Replaying an *event* topic to rebuild a read model is safe. Replaying a *command* topic re-executes transfers. Kafka is at-least-once and the offset commits after the DB write, so redelivery on crash is the normal path — every redelivery would be a duplicate debit held back only by idempotency.
4. **Partition count would become a permanent throughput ceiling.** A consumer processes its partition sequentially, so 12 partitions means at most 12 concurrent transfers, forever. A synchronous service with a 50-connection pool gives 50. Putting writes behind Kafka can *reduce* throughput while looking like it scales.

> **Say it like this:** *"We don't put money commands on a queue. We put money facts on a queue. When we answer you, the transfer is committed and durable — or it never happened."*

Burst absorption, the one real argument for async writes, is already handled: PgBouncer absorbs the connection burst, and the queue absorbs the fan-out work.

### Decision 2 — This is CQRS, not a saga. Name it correctly.

There is no cross-service flow here that can fail midway and require compensating. Money movement is one atomic Postgres transaction inside one service. Calling that a "saga" invites a question we would lose.

> **The correct name is: "an event-driven state machine with a transactional outbox."**

The saga appears only past a single primary — when sharding by `user_id` makes a cross-shard transfer impossible to do in one transaction. Saying *that* is a much stronger answer than claiming a pattern we didn't implement. See §7.

### Decision 3 — The outbox table stays, even though we have Kafka.

You **cannot** atomically commit to Postgres and publish to Kafka. "Publish right after commit" leaves a window where the transfer is durable but the process dies before the publish lands — the event is gone forever, the read side never learns about it, and the recipient is never notified. Silent, unrecoverable, invisible until someone reconciles.

Kafka's transactional producer does not help: its exactly-once semantics are Kafka-to-Kafka and cannot span a Postgres commit.

The outbox row commits **in the same transaction as the money**. A relay drains it with `FOR UPDATE SKIP LOCKED`. It is also the answer to *"what if Redpanda dies?"* — transfers keep committing, the outbox backs up, events drain on recovery. We demo this by killing the broker.

## 1.2 A Redis cache, but no projection and no replica

The Read Service queries the same Postgres with **SELECT-only grants**. The ownership boundary is enforced by database permissions, not by convention: `read_svc` is structurally incapable of writing to `ledger`.

We deliberately did not build a separate projection store.

> *"Read and write are separate services on separate scaling curves. Here the read model and the write model are the same shape — a projection earns its cost when they diverge, like a feed joining transfers to counterparty names. The events are already flowing for it; that's exactly where it plugs in."*

A projection would have required: absolute-value application (never deltas — one duplicate event silently corrupts a balance forever), a per-account sequence guard (a transfer touches two accounts, so events for one account arrive across partitions **out of order**, and a stale event would overwrite a newer balance), and rebuild-from-topic with retention configured for it. That is a lot of failure surface whose worst case is *"the sender's balance doesn't move on stage."*

### The cache: version-keyed, never value-writing

The Read Service fronts its queries with Redis. Two rules decide whether this is safe:

**Rule 1 — the balance is never cached.** It is a primary-key lookup already sitting in `shared_buffers` (microseconds), and it is simultaneously the highest-write-rate and highest-correctness value in the system. Caching it buys nothing and costs a coherence problem. What *is* worth caching is the genuinely expensive stuff: history pages with counterparty joins, the `spent_today` aggregate behind daily limits, unread notification counts, and phone lookups.

**Rule 2 — the consumer bumps a version; it never writes values into the cache.**

```
u:{uid}:v                              INCR'd by the Kafka consumer on any txn event
hist:{uid}:{v}:{cursor}:{filter}       TTL 120s
limits:{uid}:{v}:{yyyymmdd}            TTL to midnight
notif:unread:{uid}:{v}                 TTL 120s
lookup:{phone}                         TTL 300s   (not user-versioned; rarely changes)
```

```ts
async getHistory(uid, cursor) {
  const v   = await redis.get(`u:${uid}:v`) ?? '0';
  const key = `hist:${uid}:${v}:${cursor}`;
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  const rows = await this.replica.query(...);
  await redis.setex(key, 120, JSON.stringify(rows));
  return rows;
}
// consumer:  on txn.completed → INCR u:{sender}:v ; INCR u:{receiver}:v
```

A `DEL`-based cache has a race that bites in production and is invisible in testing: a reader loads stale rows from Postgres, the invalidation arrives, and *then* the reader writes its stale rows into the cache — poisoning the key until its TTL expires. With version-keyed reads that same interleaving still happens, but the stale reader writes to the **previous version's key**, which nothing will ever read again. It expires unread.

> **Say it like this:** *"We don't invalidate the cache. We make stale keys unreachable."*

Two consequences worth stating before a judge asks:

- **A consumer that wrote values into the cache would inherit every projection bug** — duplicate delivery applying twice, and cross-partition out-of-order arrival overwriting a newer value with an older one. An `INCR` is immune to both: it is commutative and monotonic, so a duplicate or late event is harmless.
- **Redis being down is not an error.** Every cache call is wrapped so a failure falls through to Postgres. Degraded, not broken. `GET /admin/health` reports `redis.ok: false` while it lasts, and `CACHE-03` in the simulator kills Redis mid-run to prove it.

Responses carry `X-Cache: HIT|MISS` and `X-Cache-Version`, so the mechanism is visible during the demo instead of being a claim.

Streaming replication is likewise not built. It is 30 fiddly minutes, does nothing for a demo dataset, and its one visible effect on stage would be replica lag making the sender's balance look stale. What matters is that the routing decision exists in code:

```ts
class LedgerRepository {
  constructor(private primary: Pool, private replica: Pool) {}
  getBalance(userId) { return this.primary.query(...); }   // read-your-own-writes
  getHistory(userId) { return this.replica.query(...); }   // stale-tolerant
}
```

Both pools point at the same DSN today. *"The routing seam is in the repository; the replica is a connection string."* True, and stronger than a half-built replica.

---

# 2. Phase 0 — 10:00–10:25 · Setup (hard stop)

**`docker compose pull` at 10:00, before anything else.** Six images on venue wifi is the single most common way to lose twenty minutes, and it runs in the background while everything below happens.

### 2.1 Checklist

- [ ] `docker compose pull` running
- [ ] Repo created, first commit **pushed**
- [ ] `SCHEMA.sql` applied — run as owner, **directly against :5432**
- [ ] `API.md` committed so D is not blocked
- [ ] RSA keypair: `openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem`
- [ ] `types.setTypeParser(20, ...)` in every service's bootstrap (see 2.4)
- [ ] Seeded demo users: Rahim, Karim, Alam, plus an admin

### 2.2 Roles

| Who | Owns | First deliverable |
|---|---|---|
| **A** | Txn Service. The ledger and the transfer path, **alone**. | `POST /transfers` green by 12:00 |
| **B** | Auth Gateway, then features on A's ledger. | login + JWT by 11:15 |
| **C** | Infra, migrations, seeds, outbox relay, Centrifugo, README, and **the scenario simulator**. | compose up + schema applied by 10:25 |
| **D** | Frontend against `API.md` mocks; wires real API from 13:00. | login + dashboard on mocks by 12:00 |

**Only A touches `TransferService`.** Two people editing the money path concurrently is how a hackathon produces a ledger that doesn't balance at 14:30.

### 2.3 docker-compose.yml

```yaml
volumes:
  pgdata:            # NAMED VOLUME. Never bind-mount pgdata to D:\ on Windows —
                     # fsync through Docker Desktop/WSL2 onto the Windows filesystem
                     # is a severe perf cliff, and we run synchronous_commit=on
                     # deliberately. Benchmarking on a bind mount would make us
                     # conclude the ledger is slow when it is the filesystem.
services:
  postgres:
    image: postgres:16
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    ports: [ "5432:5432" ]          # migrations connect HERE, directly
    command: >
      postgres
        -c shared_buffers=2GB       # postmaster-context: ALTER SYSTEM + reload
        -c max_wal_size=4GB         #   does NOT apply it. It must be set here.
        -c wal_compression=on
        -c synchronous_commit=on    # deliberately ON — see §7
        -c commit_delay=2000        # MICROseconds = 2ms. A bet on group commit.
        -c commit_siblings=5        #   MEASURE IT ON/OFF. Quote the real number.
  pgbouncer:  { ports: ["6432:6432"] }   # every app connects HERE
  redpanda:   { }                        # 12–24 partitions per topic
  centrifugo: { ports: ["8000:8000"] }
  redis:      { image: redis:7-alpine }  # read cache. NO persistence configured —
                                         # it holds nothing that isn't in Postgres.
```

```ini
# pgbouncer.ini
pool_mode = transaction
max_client_conn = 10000
default_pool_size = 50
```

`commit_delay` only engages when at least `commit_siblings` other transactions are in flight. It is a *bet* on group commit paying for 2ms of added latency. **Measure it both ways in the load test.** If it doesn't help on this hardware, turn it off and say you measured it — that answer is worth more than the setting.

### 2.4 Driver rules (non-negotiable)

```ts
import { types } from 'pg';
types.setTypeParser(20, (v: string) => parseInt(v, 10));   // int8 → number
```

Without this line, `pg` returns **every BIGINT as a string**. `balance - amount` becomes `NaN`; `balance + amount` becomes string concatenation. It is silent money corruption and it is the first thing that will bite you.

`parseInt` is safe here: max paisa is 9.007e15 ≈ ৳90 trillion. Do **not** reach for `BigInt` — `JSON.stringify` throws on BigInt values and would take down every response serializer at once.

**No ORM on the PgBouncer connection.** Raw parameterized `pg` / `pg-promise` only. Prisma and TypeORM issue server-side prepared statements that break under `pool_mode = transaction`. `LISTEN`/`NOTIFY` and session-level advisory locks are also unavailable — which is why migrations go direct to :5432 and the outbox relay polls with `SKIP LOCKED` rather than listening.

**No architecture discussion after 10:25.** The design is decided. Anything unresolved gets the simpler option.

---

# 3. Phase 1 — 10:25–12:00 · Ledger core (A) + auth (B)

Everything in this phase is **P0**. Nothing here is negotiable, and no P1 feature starts until the 12:00 checkpoint is green.

**C starts the scenario simulator at 10:30, in parallel.** The invariant checks are pure SQL and need no API, so the harness is verifying conservation, drift and append-only before `POST /transfers` exists. From that point on, A's ledger is correct when the board is green — not when it feels right. See `SIMULATOR.md`.

Full DDL is in `SCHEMA.sql`. The essentials and *why* they exist:

### 3.1 What the database guarantees on its own

| Guarantee | Mechanism | Why not in application code |
|---|---|---|
| Every transaction balances to zero | `assert_balanced()` deferred constraint trigger, ≥2 legs and `SUM = 0` | Fires at COMMIT, after all legs exist. Application code can be bypassed; a trigger cannot. |
| The ledger is append-only | `REVOKE UPDATE, DELETE ON ledger.entries FROM txn_svc` | The app is *incapable* of editing history, not merely disinclined. Requires a separate owner role for migrations — a `REVOKE` from a table's owner is meaningless. |
| No account goes negative | `CHECK (type = 'SYSTEM_MINT' OR balance >= 0)` | Covers HOLD and ESCROW too — this is what catches a double-settle of a held transfer. |
| A transaction is reversed at most once | `CREATE UNIQUE INDEX ... WHERE kind = 'REVERSAL'` | An `if` statement two workers can both pass is not a constraint. |
| A held transfer resolves once — settle **or** cancel, never both | `CREATE UNIQUE INDEX ... WHERE kind IN ('HOLD_SETTLE','HOLD_CANCEL')` | Same reason. |
| Idempotency cannot leak across users | `PRIMARY KEY (user_id, key)` | A globally-unique key lets user A replay user B's cached response by guessing it. That is a data leak, not a collision. |

**The `ledger.entries (txn_id)` index is mandatory.** `assert_balanced()` runs `SUM(...) WHERE txn_id = ?` once **per leg** at every commit. Without that index it is a sequential scan on every insert, and the load test collapses. This is the single easiest performance bug to ship and the hardest to diagnose at 13:30.

**Partitioning:** `ledger.entries` is range-partitioned by month, with a `DEFAULT` partition so that one row with an unexpected `created_at` — a bad seed, clock skew, a demo running past midnight — cannot throw `no partition of relation found` mid-demo. The constraint trigger is attached **per partition**, not to the parent, because whether a partitioned parent accepts `CREATE CONSTRAINT TRIGGER` varies while a partition is an ordinary table and always does. `ledger.create_month_partition()` attaches it automatically; a partition without that trigger is a silent hole in the conservation guarantee.

### 3.2 The transfer — the whole money path, one transaction

```ts
async execute({ senderId, receiverId, amount, idemKey, note }) {
  const reqHash = sha256(canonical({ senderId, receiverId, amount }));

  return this.db.tx(async (t) => {
    // ---- 1. Claim the idempotency key FIRST, before anything else happens.
    const claimed = await t.query(
      `INSERT INTO ledger.idempotency_keys(user_id,key,request_hash) VALUES ($1,$2,$3)
       ON CONFLICT (user_id,key) DO NOTHING RETURNING key`,
      [senderId, idemKey, reqHash]);

    if (!claimed.rowCount) {
      // A concurrent duplicate BLOCKS on the unique index until the first
      // transaction commits or rolls back, so `response` is populated by the
      // time we read it. If the first one rolled back, we'd have won the claim.
      const prior = await t.query(
        `SELECT request_hash, response FROM ledger.idempotency_keys
          WHERE user_id=$1 AND key=$2`, [senderId, idemKey]);
      // Same key, different payload = client bug or attack. NEVER replay it.
      if (prior.rows[0].request_hash !== reqHash) throw new IdempotencyKeyReuse(); // 422
      return prior.rows[0].response;                     // double-tap → ONE debit
    }

    // ---- 2. Lock both accounts in ASCENDING id order.
    // Two concurrent A↔B transfers acquire locks in the same order and
    // therefore cannot deadlock. This is the whole deadlock strategy.
    const ids = [senderAcc, receiverAcc].sort((a, b) => a - b);
    await t.query(`SELECT id,balance FROM ledger.accounts
                    WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [ids]);

    // ---- 3. Business rules, now that balances are stable under our lock.
    if (senderBalance < amount)     throw new InsufficientFunds();
    if (senderStatus === 'FROZEN')  throw new AccountFrozen();
    if (spentToday + amount > cap)  throw new DailyLimitExceeded();

    // ---- 4. Write the money. Transaction, both legs, both balances.
    const txn = await t.query(`INSERT INTO ledger.transactions(...) RETURNING *`);
    await t.query(`INSERT INTO ledger.entries(txn_id,account_id,amount)
                   VALUES ($1,$2,$3),($1,$4,$5)`,
                  [txn.id, senderAcc, -amount, receiverAcc, amount]);
    await t.query(`UPDATE ledger.accounts SET balance=balance-$1 WHERE id=$2`, [amount, senderAcc]);
    await t.query(`UPDATE ledger.accounts SET balance=balance+$1 WHERE id=$2`, [amount, receiverAcc]);

    // ---- 5. Outbox, in the SAME commit. This is what makes the event durable.
    await t.query(`INSERT INTO ledger.outbox(topic,payload) VALUES ('txn.completed',$1)`,
                  [JSON.stringify(txn)]);

    // ---- 6. Store the response so a replay returns exactly this.
    await t.query(`UPDATE ledger.idempotency_keys SET response=$1
                    WHERE user_id=$2 AND key=$3`, [JSON.stringify(txn), senderId, idemKey]);

    return txn;   // ← returned to the client. Committed and durable, or thrown.
  });
}
```

### 3.3 Every state transition is an atomic CAS — never read-check-write

```sql
UPDATE ledger.transactions SET state='REVERSED'
 WHERE id=$1 AND state='COMPLETED' RETURNING *;
-- rowCount = 0 → someone already reversed or cancelled it. Abort. Do not compensate.
```

The conditional `UPDATE` **is** the lock. A `SELECT`, then an `if`, then an `UPDATE` is a double-spend waiting for two concurrent workers — and with Kafka redelivery in the system, two concurrent workers is the normal case, not a rare one. This applies to every transition: `HELD → COMPLETED`, `HELD → CANCELLED`, `COMPLETED → REVERSED`, and every `money_requests` transition.

### 3.4 Auth

Phone + PIN (**bcrypt cost 10** — cost 12 is ~250ms and would dominate the load test; note the tradeoff in the README) → RS256 JWT, 15-minute access token plus a rotating refresh token stored hashed.

Presenting an **already-consumed** refresh token means it was stolen and replayed, so the entire token family is revoked — thief and legitimate user both logged out, which is the correct outcome. This demos in thirty seconds and most teams won't have it.

Lockout after 5 failed PIN attempts. A 4-digit PIN is trivially brute-forced and a judge will probe exactly this.

**No TOTP at login.** TOTP is a step-up mechanism for dangerous actions, not a login tax.

### 3.5 Signup mints real money

The ৳100,000 bonus is a **real double-entry transaction** (`kind: SIGNUP_BONUS`) debiting `SYSTEM_MINT`, in the same commit as the account creation. `SYSTEM_MINT` goes deeply negative, which is correct — it *is* the money supply — and `SUM(entries)` across the whole ledger stays exactly zero.

Nothing in this system bypasses the ledger, including the money the system gives away. That sentence is worth saying out loud.

### 3.6 Checkpoint 12:00 — a gate, not a suggestion

Run all four. If any fails, **cut features, never cut this.**

1. Two curl calls, same `Idempotency-Key` → **one** debit, identical response body twice.
2. Same key, different amount → `422 IDEMPOTENCY_KEY_REUSE`.
3. Insert one unbalanced leg by hand → rejected at `COMMIT` with the trigger's message.
4. `UPDATE ledger.entries SET amount = 999 WHERE id = 1` as `txn_svc` → **permission denied**.

---

# 4. Phase 2 — 12:00–13:00 · Features

Build strictly in this order. **Stop at the cut line when the clock says so, not when you feel behind.** Deciding what to drop at 12:50 under pressure is how teams drop the wrong thing.

### 4.1 P1 — above the line (this is the demo)

| # | Feature | Owner | Notes |
|---|---|---|---|
| 1 | **Outbox relay** | C | `WHERE processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100` → Redpanda. Many relays, no contention, no duplicates. |
| 2 | **Centrifugo bridge** | C | Consume `txn.completed`, publish to the receiver's channel. Stock Redis-engine config — do not hand-roll WS. |
| 3 | **Recipient name confirmation** | B+D | Typo protection. The single most common real-world money error. |
| 4 | **Duplicate-send guard** | B+D | Same recipient + amount within 120s → *"you sent ৳500 to Rahim 90 seconds ago, send again?"* |
| 5 | **Money requests** — create / approve / decline / cancel | B | Creating a request moves **no money**. A request is a message, not a debit. That consent boundary is the point. |
| 6 | **Reversals** | A | New transaction, `kind: REVERSAL`, mirrored entries, CAS off `COMPLETED`. The original row is untouched forever. Say **"compensating transaction."** |
| 7 | **Sweeper** | C | Resolves `HELD`/`PENDING` past deadline, expires stale requests. `SKIP LOCKED` so two instances cannot double-settle. Self-healing, not human-noticed. |
| 8 | **Daily limit + velocity guard** | B | ৳50,000/day with visible remaining allowance; >10 txn/min → PIN re-entry. |
| 9 | **Freeze / unfreeze** | B | Frozen accounts **still receive**; only sending is blocked. |
| 10 | **Transaction detail showing both ledger legs** | D | Makes double-entry visible to a judge without opening the code. Nearly free — the data is already in the response. |
| 11 | **Disputes + admin resolution** | B | See §4.3. The only human-in-the-loop flow in the system, and the one place an admin can move money. |
| 12 | **Redis cache on the Read Service** | C | Version-keyed (§1.2). ~30 min: one `INCR` in the consumer, one wrapper on three read paths. |

**Centrifugo channel authorization is mandatory, not optional.** User A must not be able to subscribe to user B's channel. Centrifugo's user-limited channel form (`user#42`) plus a JWT connection token is the shortest path — **verify the exact syntax against the Centrifugo docs before wiring**, it is the one piece of third-party config in the stack.

### 4.2 The 60-second undo window — the showpiece

This is P1 and worth building, but it is also the most intricate thing on the list, so the design is fixed here and not improvised at 12:30.

**A held transfer is two separately balanced transactions, never one three-legged one.**

```
Send ৳10,000 (above the ৳5,000 threshold)
  TXN1  kind=TRANSFER  state=HELD
        entries: sender −10,000 · HOLD(sender) +10,000        ← balanced, commits NOW
        settle_after = now() + 60s

The money has ALREADY left the sender. It cannot be double-spent. It has
simply not arrived yet.

  settle (sweeper, after 60s)          cancel (user taps Undo)
  TXN2 kind=HOLD_SETTLE                TXN2' kind=HOLD_CANCEL
    HOLD(sender) −10,000                 HOLD(sender) −10,000
    receiver     +10,000                 sender       +10,000
    parent_txn_id = TXN1                 parent_txn_id = TXN1
    CAS TXN1 HELD → COMPLETED            CAS TXN1 HELD → CANCELLED
```

Three independent things stop a double-settle:
1. **CAS** — `WHERE id=$1 AND state='HELD'`; the loser updates 0 rows and aborts.
2. **Row lock** — both paths `FOR UPDATE` the HOLD account, so they serialize.
3. **`CHECK (balance >= 0)`** — HOLD is per-user and non-negative, so a second debit is rejected by the database even if the first two were somehow bypassed.

**HOLD accounts are per-user, never global.** A single shared HOLD row would be `FOR UPDATE`-locked by every held transfer in the system and would serialize the entire write path — the load test would collapse on that one row.

The sender's balance shows a separate **held** line while a transfer is in flight, so ৳10,000 leaving and not yet arriving never looks like missing money.

### 4.3 Disputes — the only place an admin moves money

Everything else in this system is a user acting on their own money. Disputes are the one flow where a human with authority intervenes, so the audit trail matters more than the feature.

```
  Either party raises            Admin decides
  (sender OR receiver,           ┌──────────────────────────────────┐
   within 7 days)                │                                  │
        │                        ▼                                  ▼
   POST /disputes  ──▶  OPEN ──▶ REVERSED                       REJECTED
                          │      (compensating txn created)     (no money moves)
                          │
                          └──▶ reversal FAILS (receiver spent it)
                               → stays OPEN, attempts++, error recorded
```

Four decisions, each of which a judge can probe:

1. **Raising a dispute moves no money and freezes nothing.** It creates a work item. Freezing a transaction on accusation would let anyone grief a recipient by disputing every payment.
2. **One *open* dispute per transaction**, enforced by a partial unique index — not an `if`. A closed dispute can be superseded by a new one later.
3. **`REVERSE` is one atomic transaction**: create the `REVERSAL` with mirrored entries, CAS the original `COMPLETED → REVERSED`, CAS the dispute `OPEN → REVERSED`. All three or none.
4. **If the receiver already spent the money, the whole thing rolls back and the dispute stays `OPEN`.** We deliberately did *not* invent a `REVERSAL_FAILED` state — the dispute genuinely is still open. The admin retries when the balance recovers, or rejects it. **Volunteer this:** *we don't fabricate money to resolve a dispute.* It is the most senior-sounding sentence available in the whole demo.

`resolution` text is mandatory, enforced by a `CHECK` — a dispute cannot leave `OPEN` without one. Every resolution writes `ledger.audit_log` with actor, before/after JSONB and reason.

The admin queue (`GET /admin/disputes`) returns `reversible_now` computed at read time. **It is advisory only** — the receiver can spend the money a millisecond later, so the resolve call re-checks inside its own transaction. Never gate the reversal on that field; it exists to order the queue, not to authorise.

### 4.4 P2 — below the line, only if genuinely ahead

| Feature | Cost | Note |
|---|---|---|
| **TOTP step-up** | high | Enrolment QR, 8 hashed single-use backup codes, and per-(user, time-step) replay protection — a TOTP code is otherwise reusable inside its own 30s window. Note the split: the gateway can enforce **amount thresholds** because it can read `amount_paisa`, but *"first-ever recipient"* is a ledger fact the gateway does not hold and must live in the Txn Service. Ship one or the other; don't claim both. |
| **Split bill** | low | One debit, N credits, one atomic transaction. `assert_balanced` covers 2 legs or 20 unchanged — genuinely nearly free, and it *demonstrates* that multi-leg double-entry was designed in rather than bolted on. Best value P2 item. |
| **Hash-chain verifier** | medium | ~15 min, and judges remember it. A `prev_hash` column would force every insert to read the previous row's hash — a global serialization point that destroys write throughput. Instead a verifier walks the append-only log in id order **out-of-band** and checkpoints a rolling hash into `ledger.chain_checkpoints`. Same tamper detection, zero write-path cost. Being able to explain *why it's asynchronous* is worth more than the feature. |
| Escrow to unregistered phone | medium | `ESCROW` account type exists in the schema; auto-refund via the same sweeper. |
| Masked recipient name | low | Already resolved in `API.md`: first name + last initial. Full names leak the phonebook to number-enumeration; full masking defeats the recipient-confirmation screen, which only works if a human can recognise the wrong person. |
| Scheduled transfer, statements, reminders, log-out-everywhere | low each | Pure garnish. |
| Fraud velocity consumer | medium | The best justification for the Kafka consumer existing at all. |

---

# 5. Phase 3 — 13:00–13:45 · Proof

**This phase wins the judging.** It is worth more than everything below the Phase 2 cut line combined. If Phase 2 is running late, take the time from Phase 2, not from here.

### 5.1 The simulator board and the load test — run them live, never from a screenshot

200 accounts, 5,000 concurrent transfers in a ring (i → i+1). Asserts **total supply unchanged** and **no negative balance**.

This is scenario `CON-03` in the simulator, not a separate script. By 13:00 it runs inside a board of ~50 scenarios that includes container kills, client aborts mid-request, and every concurrency race in the system — and **every one of them re-asserts conservation, drift and non-negativity for free**. The full catalog and schedule are in `SIMULATOR.md`.

The harness is written during **Phase 1**, not at 13:00. Authoring it under time pressure is exactly where this goes wrong, and it is also the fastest way to catch a ledger bug at 11:30 while there is still time to fix it.

The ring topology is deliberate: each account is touched by exactly two concurrent transfers, which is maximum realistic contention without a single hot row. With ascending-id lock ordering it produces **zero deadlocks** — and "0 deadlocks across 5,000 concurrent transfers" is a number worth putting on screen.

### 5.2 Measure, don't claim

- **`commit_delay` on vs. off.** Print both TPS numbers. *"We measured 1,840/s"* beats any confident round figure, and *"we tried it and it didn't help on this hardware, so we turned it off"* is a better answer than either.
- `GET /admin/metrics` — TPS, p95 latency, active locks, connection count, live during the run.

### 5.3 The two crash tests

1. **Kill the Txn Service mid-load, restart.** Nothing lost, no partial transfers, ledger still balances.
2. **Kill Redpanda.** Transfers keep committing. The outbox backs up. Bring it back — events drain and the notifications arrive late. *This is the entire architecture argument demonstrated in fifteen seconds*, and it is the most persuasive thing you will do all day.

### 5.4 `GET /admin/integrity`

Live proof that `SUM(ledger.entries.amount) = 0`, every cached balance equals its ledger-derived balance, no non-mint account is negative, and the hash chain verifies. On failure it must show the **actual numbers and offending account ids** — if this fails in front of a judge, showing exactly what broke is a far better recovery than a generic red X.

### 5.5 `EXPLAIN ANALYZE` — partition pruning

Screenshot a date-ranged history query showing only the relevant partition scanned. Proof, not assertion.

---

# 6. Phase 4 — 13:45–14:25 · UI · and Phase 5 — 14:25–14:50 · Freeze

Full screen-by-screen detail is in `UI_SPEC.md`. The one thing that matters: **two browser windows side by side, money leaves one, Centrifugo lands it live in the other.** Wire that even if something else is unfinished — it is the best visual moment available and it makes the entire event pipeline visible in two seconds.

Phase 5: README with the architecture diagram and design decisions. Seeded demo accounts. **Rehearse the demo twice.** Push at 14:50 and stop.

### The demo script — build backwards from this

| # | Beat | Proves |
|---|---|---|
| 1 | Register → *"৳100,000 added"* | Even the bonus is double-entry |
| 2 | Send ৳2,500, recipient name confirmation | *the brief's own words*; human-error design |
| 3 | Second window updates live | Outbox → Kafka → Centrifugo, end to end |
| 4 | Double-tap send, same idempotency key | One debit. Show both identical responses. |
| 5 | Send ৳10,000 → 60s undo → cancel | Money conserved at every instant |
| 6 | Alam requests ৳1,200 → Rahim approves | *the brief's other quote*; consent boundary |
| 7 | Reverse a transaction | Ledger **grew**. Nothing was edited. |
| 8 | Run the simulator live — ~50 scenarios, incl. container kills | Supply unchanged, 0 deadlocks, conservation held across all of them |
| 9 | **Kill Redpanda. Transfers still work.** | Correct failure mode for payments |
| 10 | `/admin/integrity` — sum = 0 | The invariant, on screen |

---

# 7. Defense

## 7.1 Scaling — the million-user answer

Give it as a **bottleneck ladder**, in the order you would actually hit them:

| Wall | Fix | Built? |
|---|---|---|
| Connections (10k concurrent clients) | PgBouncer, transaction mode, 10k → 50 backends | ✅ |
| Fan-out work (notify, fraud, statements) | Outbox → Kafka → consumers | ✅ |
| History table size (7B+ rows/yr) | Monthly range partitions; archiving is `DETACH`, a metadata op | ✅ |
| Read throughput | Redis in front, then replicas + the repository routing seam | cache ✅, seam ✅, replica no |
| **Write throughput, single primary** | ← **this is the real wall** | measured |
| Hot-account contention | Shard `SYSTEM_MINT` into N; sub-accounts for hot merchants | designed |
| Beyond one primary | Shard by `user_id`; cross-shard transfers go two-phase | design only |

Two things make this better than every other team's answer:

**Name the actual wall.** Scaling Txn Service instances buys nothing past the primary's commit ceiling — it just moves the queue. One primary with `synchronous_commit=on` lands in the low thousands of write transactions/sec, and a transfer is ~6 row writes, so the ceiling is order-of-magnitude 1–3k transfers/sec. The load test gives the real figure. Quote **the measured number**, never a round one.

**Name the contention, not just the throughput.** What bites first is not total TPS — it is one hot row serializing on `FOR UPDATE`. `SYSTEM_MINT` at signup is the obvious one; a popular merchant account would be the next. Knowing the bottleneck is *lock contention on specific rows* rather than *"we need more servers"* is the difference between reading about scale and understanding it.

**And that is where the saga finally earns its name.** Sharding by `user_id` means a cross-shard transfer cannot be one transaction, so it becomes a genuine two-phase compensating flow. *"We didn't build it because it is the wrong complexity at our stage — but the ledger is already append-only and idempotent, which is exactly what makes it possible."*

## 7.2 Deliberately not built — say this unprompted

Real KYC, cash-in / cash-out, currency conversion, `synchronous_commit=off`, Citus, per-shard sequencers, a separate projection store, streaming replication.

Naming what you skipped **and why** reads as senior. Volunteering it before you're asked reads as confident.

## 7.3 SOLID

- **S** — controller does HTTP, service does rules, repository does SQL. Nothing else.
- **O** — `TransferStrategy`: `P2PTransfer`, `RequestSettlement`, `Reversal`, `Refund`, `SplitBill`, `HoldSettle`. A new money movement type is one new class and zero edits to existing ones. This is literally the *"new features with less effort"* criterion.
- **L** — every strategy honours the same contract; the executor swaps them blindly.
- **I** — `BalanceReader` and `LedgerWriter` are separate interfaces. Reads do not inherit write methods, which is why the Read Service can hold SELECT-only credentials.
- **D** — repositories injected as interfaces. It is how primary/replica routing exists without business logic knowing anything about it.

In the code: **Repository, Strategy, State Machine, Transactional Outbox, CQRS, Factory, Middleware/Decorator.**

## 7.4 Answers to have loaded

| They ask | You say |
|---|---|
| Why isn't the write path on Kafka? | We don't queue money commands, we queue money facts. When we answer you, it's committed or it never happened. |
| Why keep an outbox if you have Kafka? | You can't atomically commit to Postgres and publish to Kafka. Without the outbox, a crash between the two loses the event forever. |
| Is this a saga? | No — it's an event-driven state machine with a transactional outbox. The saga appears when we shard past one primary. |
| Why not a separate projection DB? | Read and write models are the same shape here. A projection earns its cost when they diverge; the events are already flowing for it. |
| Where's the truth? | `ledger.entries`. `accounts.balance` is a cache, and `/admin/integrity` proves they agree. |
| Someone taps send twice? | Idempotency key scoped per user. Same payload replays the response; different payload is rejected 422. |
| Deadlocks? | Locks always acquired in ascending account id. Two concurrent A↔B transfers cannot deadlock. 0 deadlocks in 5,000 concurrent transfers. |
| What if Redpanda dies? | Transfers keep committing, outbox backs up, events drain on recovery. Let me show you. |
| Why is `SYSTEM_MINT` negative? | It's the money supply. Negative is correct. The ledger still sums to exactly zero. |
| Why `synchronous_commit = on`? | It's money. We'd rather be slower than lose a committed transfer — and we measured the cost. |
| Can you edit the ledger? | The application role has no UPDATE or DELETE on `entries`. Try it — permission denied. |
| What if the receiver already spent it? | The reversal fails with insufficient funds and becomes a dispute. We don't fabricate money to undo a transfer. |
| How do you know it's correct under load? | We don't assert it, we test it. 5,000 concurrent transfers, supply unchanged, live, right now. |
| How do you invalidate the cache? | We don't. Keys embed a version the consumer bumps, so stale keys become unreachable and expire unread. And we never cache the balance. |
| What if a dispute can't be reversed? | It stays open. We don't fabricate money to resolve a dispute — the admin retries or rejects, and both are audited. |
