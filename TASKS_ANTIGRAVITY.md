# Assignment: Antigravity — Disputes, Bill Payment, Shared Bill Payment

You are one of two agents working this backend in parallel, coordinated by
Claude (acting as master — final integration into `app.module.ts` and any
cross-cutting conflict resolution goes through Claude, not you or the other
agent). The other agent, Codex, is working `TASKS_CODEX.md` at the same
time: bootstrap (`main.ts`/`app.module.ts`), `AuthModule`, `QueryModule`,
and admin integrity/freeze. Your two task sets touch **disjoint files** —
see "Ownership boundaries" at the bottom before you start.

Read `BUILD_LOG_CLAUDE.md` in full first for how this repo got here (three
services → one NestJS monolith, ports/adapters at module boundaries, three
DB roles kept as three `pg.Pool`s in one process). Do not re-litigate that
decision — it's settled. These three features (disputes, bill payment,
shared bill payment) are the user's explicit top priority for this build.

**Infra is already up**: `docker compose up -d`, then
`node scripts/apply-schema.js` (idempotent, safe to re-run any time).

**You cannot fully runtime-test until Codex's `AuthModule` exists** (you
need a login to get a JWT). Write and unit-reason through your services in
the meantime; coordinate with Claude/Codex on when auth is ready for
integration testing.

---

## What already exists — read before writing anything, and don't edit `core/`

```
apps/api/src/
  common/
    all-exceptions.filter.ts                  AppError -> {error,message,details}
    decorators.ts                             @IdempotencyKey() @StepUpToken() @CurrentUser()
    idempotency.util.ts                       claimIdempotencyKey() / storeIdempotencyResponse()
    step-up.util.ts                           requireStepUp({userId, token, reason, always?, amountPaisa?})
    guards/jwt-auth.guard.ts, guards/admin.guard.ts
  modules/ledger/core/                        READ-ONLY for you — Codex depends on it staying stable too
    accounts.repository.ts                    getUserAccountId, getOrCreateHoldAccountId, getBalance, spentToday, dailyLimit
    users.repository.ts                       reads auth.users_public (id/phone/name/status/role/token_version)
    ledger-writer.port.ts + .service.ts        THE shared double-entry primitive — read this file first, in full
    reversal-core.service.ts                  applyReversal(client, originalTxnId) — reuse this, don't reimplement
  modules/ledger/transfers/                   working reference implementation — copy its SHAPE, not its code
  modules/ledger/reversals/                   working reference implementation — you'll call the same core service
```

`packages/shared` (`@pstu/shared`, workspace package — rebuild with `npm run
build -w packages/shared` after any change) already has everything you need
for these three features:
- Errors: `NotAParty`, `InvalidState`, `DisputeAlreadyOpen`,
  `DisputeWindowClosed`, `SelfTransfer`, `UserNotFound`, `TxnNotFound`,
  `IdempotencyKeyReuse`, `ValidationError`, `InsufficientFunds`,
  **plus `BillNotFound`, `BillShareNotFound`, `RequestNotFound` — already
  added for you, don't redefine them.**
- `TxnKind` already includes `'BILL_SHARE_SETTLE'`.
- `withTransaction`, `sha256`/`canonical` (idempotency hashing),
  `verifyStepUpToken` (used inside `requireStepUp`, don't call it
  directly), money helpers.

SQL already applied: `infra/sql/002_bills_and_role_claude.sql`
(`ledger.bills` / `ledger.bill_shares` tables, full column list there —
read it, don't guess the schema) and
`infra/sql/003_bill_share_settle_kind_claude.sql` (the CHECK constraint
already allows `BILL_SHARE_SETTLE` — this is done, you don't need a new
migration for it).

`ledger.money_requests` and `ledger.disputes` are both already in
`SCHEMA.sql` as given — no new tables needed for those two features.

---

## Your deliverables

### 1. `modules/ledger/disputes/` (`dto.ts` already exists — `RaiseDisputeDto`, `ResolveDisputeDto`)

- **`raise(userId, txnId, reason)`** — load the transaction, `TxnNotFound`
  if missing, `NotAParty` (403) unless `userId` is `sender_id` or
  `receiver_id`, `DisputeWindowClosed` (422) if `now() - created_at >
  config.disputeWindowDays` days. Insert into `ledger.disputes`; **catch
  Postgres `error.code === '23505'`** (the partial unique index
  `one_open_dispute_per_txn`) and rethrow as `DisputeAlreadyOpen` (409) —
  do **not** pre-check with a `SELECT` first, the whole point of that index
  is that the DB is the single source of truth for "already open," not an
  app-level `if` two concurrent requests could both pass.
- **`listMine(userId)`** — `SELECT * FROM ledger.disputes WHERE
  raised_by=$1 ORDER BY id DESC`.
- **`listQueue(state, cursor, limit)`** (admin-facing) — join
  `ledger.transactions` + `auth.users_public` (sender/receiver names) and
  compute `reversible_now` as *the receiver's `USER` account balance ≥ the
  transaction's amount*, at read time. **This field is advisory only** —
  never gate the actual resolve on it, only use it to order/display the
  queue.
- **`resolve(adminId, disputeId, action, resolution, idemKey,
  stepUpToken)`** — `requireStepUp({userId: adminId, token: stepUpToken,
  reason: 'ADMIN_ACTION', always: true})` first. Then, **inside
  `withTransaction`**: `claimIdempotencyKey` (keyed on `adminId` — an
  admin's own idempotency namespace, separate from any regular user's),
  `SELECT ... FOR UPDATE` the dispute row, `AppError(404,
  'DISPUTE_NOT_FOUND', ...)` / `InvalidState` if missing/not-`OPEN`.
  - `action === 'REJECT'`: one CAS `UPDATE ledger.disputes SET
    state='REJECTED', resolution=$1, resolved_by=$2, resolved_at=now()
    WHERE id=$3 AND state='OPEN'`.
  - `action === 'REVERSE'`: call
    `this.reversalCore.applyReversal(t, dispute.txn_id)` — **reuse this,
    do not reimplement reversal logic** — then CAS the dispute to
    `REVERSED` with `reversal_txn_id` set to the new reversal's id.
  - Either way, write one `ledger.audit_log` row (`actor_id=adminId,
    actor_kind='ADMIN', action, entity='dispute', entity_id=disputeId,
    before, after`).
  - `storeIdempotencyResponse` and return.
  - **Critical — read this twice**: wrap the whole `withTransaction` call
    in `try/catch`. If `applyReversal` throws `InsufficientFunds`, the
    transaction has already rolled back, so the dispute in the DB is
    **untouched — still `OPEN`, `attempts` unchanged**. In the `catch`
    block, run a **separate, fresh query** (not inside the failed
    transaction — it's gone): `UPDATE ledger.disputes SET attempts =
    attempts + 1, last_attempt_at = now(), last_attempt_error = $1 WHERE id
    = $2`, then **rethrow** so the controller still returns 402 to the
    admin. This two-phase shape — attempt inside a transaction that can
    roll back, then record the failure in a transaction that can't — is
    the one genuinely subtle part of this whole module. See PLAN.md §4.3
    point 4 for why the dispute must stay genuinely `OPEN` rather than
    moving to some invented `REVERSAL_FAILED` state: the admin can retry
    once the receiver's balance recovers, or reject it, and both paths must
    still work.
- **Controllers**: `POST /disputes`, `GET /disputes` in
  `modules/ledger/disputes/disputes.controller.ts` (guarded with
  `JwtAuthGuard` only — any logged-in user). Admin routes
  (`GET /admin/disputes`, `POST /admin/disputes/:id/resolve`) go in a
  **new file** `apps/api/src/modules/admin/admin-disputes.controller.ts`
  (guarded with `JwtAuthGuard` + `AdminGuard`) — register it in
  `AdminModule` alongside Codex's `AdminIntegrityController` once that
  module exists. **Do not create `admin.module.ts` yourself** — Codex owns
  that file; add your controller to its `controllers` array once it
  exists, or hand the one line to Claude if there's any doubt about
  overlapping edits.

### 2. `modules/ledger/requests/` — "Bill Payment (1:1)"

- **`create(requesterId, fromPhone, amountPaisa, note)`** — resolve phone
  via `UsersRepository`, `SelfTransfer` (422) if it resolves to
  `requesterId`. Insert `ledger.money_requests` (`expires_at = now() +
  24h` — add this as a named constant/config value, don't hardcode `24` in
  three places), `state='PENDING'`. **No money moves, no idempotency key
  required** — same reasoning as everywhere else: a request is a message.
- **`pay(payerId, requestId, idemKey, stepUpToken)`** — inside
  `withTransaction`: claim idempotency key, `SELECT ... FOR UPDATE` the
  request, `RequestNotFound` / `InvalidState` if missing/not-`PENDING`/
  expired, `NotAParty` unless `payerId === request.payer_id`. Apply the
  same step-up rules as a transfer — copy the *shape* of
  `TransfersService`'s first-time-recipient + amount-threshold checks
  (don't import `TransfersService` itself; you already have a numeric
  `requester_id`, not a phone, so the query is slightly different). Call
  `ledgerWriter.moveMoney(t, {senderId: payerId, receiverId:
  request.requester_id, amountPaisa: request.amount, kind:
  'REQUEST_SETTLE', note: request.note})` — **reuse the port, never
  hand-roll a second double-entry write.** CAS the request `PENDING ->
  PAID` with `settled_txn_id` set, in the same transaction.
- **`decline`** (payer) → `DECLINED`, **`cancel`** (requester) →
  `CANCELLED`, **`remind`** (requester, once/hour via `reminded_at`) — all
  three are CAS-off-`PENDING`; a request that expired between page-load and
  tap returns `InvalidState` (409). `remind` is a no-op beyond the rate
  limit and a DB timestamp update — there's no notification pipeline yet,
  but the endpoint's *contract* (rate limit, 409 when not PENDING) should
  still be real.

### 3. `modules/ledger/bills/` — Shared Bill Payment (the new feature)

Full endpoint shapes are already written in `API.md` under "Bill Payment"
— read that section before writing the controller, it's the contract.

- **`create(creatorId, title, shares: {phone, amountPaisa}[])`** — resolve
  every phone (`UserNotFound` if any miss), reject if any share resolves to
  `creatorId` (`SelfTransfer`, 422 — you cannot owe your own bill), reject
  fewer than 2 shares or any `amountPaisa <= 0` (`ValidationError`, 400),
  reject duplicate phones in the same request (`ValidationError`). Insert
  `ledger.bills` with `total_amount = sum(shares)` (computed server-side,
  never trust a client-sent total), then one `ledger.bill_shares` row per
  share — **all inside one `withTransaction`**, so a partial failure never
  leaves a bill with fewer shares than requested.
- **`pay(payerId, billId, idemKey, stepUpToken)`** — inside
  `withTransaction`: claim idempotency key, `SELECT ... FOR UPDATE` the
  `(billId, payerId)` row in `ledger.bill_shares` — `BillShareNotFound`
  (404) if none, `InvalidState` (409) if not `PENDING`. Load the bill row
  too (need `created_by`, and reject with `InvalidState` if the bill is
  `CANCELLED`). Apply step-up rules the same way as Requests (amount
  threshold + first-time-recipient, checked against `created_by`). Call
  `ledgerWriter.moveMoney(t, {senderId: payerId, receiverId:
  bill.created_by, amountPaisa: share.amount, kind: 'BILL_SHARE_SETTLE',
  note: bill.title})`. CAS the share to `PAID` with `settled_txn_id`. Then:
  `SELECT count(*) FROM ledger.bill_shares WHERE bill_id=$1 AND state !=
  'PAID'` — if that's zero, CAS the bill `OPEN -> SETTLED` in the **same**
  transaction. Return `{transaction, balance_paisa, bill: {id, state}}`
  exactly matching `API.md`.
- **`listMine(userId, role: 'created'|'owed')`**, **`getById(billId)`** —
  plain reads; fine to leave on `LEDGER_POOL` for now (`txn_svc` already
  has `SELECT` on these tables) even though architecturally they "should"
  be in `QueryModule` — that's a one-file move later, not urgent, and it
  keeps this feature self-contained while both of you are working at once.
- **`cancel(creatorId, billId)`** — P2, build only if you finish everything
  else first. CAS every `PENDING` share to `CANCELLED`, then the bill to
  `CANCELLED`. **Never touch an already-`PAID` share** — that money moved
  for real; undoing it is a reversal/dispute, not a cancellation.

---

## Conventions — same ones Codex is following

- Every new error is a subclass in `packages/shared/src/errors.ts` — you
  shouldn't need any beyond what's already added, but if you do, check
  `TASKS_CODEX.md` first so you don't duplicate one under a different name.
- Every money-writing method takes a `PoolClient`, called from inside
  `withTransaction(pool, async (t) => {...})` at the top of the
  controller-facing service — never open a second, independent transaction
  inside something that's supposed to be atomic with its caller.
- **Idempotency claim happens FIRST**, before any other read/write in the
  transaction — copy the shape from `modules/ledger/transfers/transfers.service.ts`
  or `modules/ledger/reversals/reversals.service.ts`. If the claim says
  `isNew: false`, return its `response` immediately; don't re-run business
  logic "just to check."
- **CAS, never read-check-write**, for every state transition
  (`PENDING->PAID`, `OPEN->REVERSED`, etc.): `UPDATE ... WHERE id=$1 AND
  state=$2 RETURNING *`, check `rowCount`. This is the one thing every
  scenario the eventual simulator runs will probe hardest.
- **Reuse `LedgerWriterPort.moveMoney` for every double-entry write, no
  exceptions.** If a case genuinely doesn't fit its params, extend the
  port's interface (and tell Claude — that file is shared with Codex's
  track too, even though Codex doesn't currently call it) rather than
  bypassing it with a raw `INSERT INTO ledger.entries`.
- Which pool: **`LEDGER_POOL` only**, everywhere in your track.

## Ownership boundaries (so you and Codex never touch the same file)

**Yours**: `apps/api/src/modules/ledger/disputes/**`,
`apps/api/src/modules/ledger/requests/**`,
`apps/api/src/modules/ledger/bills/**`,
`apps/api/src/modules/admin/admin-disputes.controller.ts` (new file, added
to Codex's `AdminModule` once it exists — don't create `admin.module.ts`
itself). **Not yours**: `apps/api/src/modules/ledger/core/**` (read-only —
Codex's track doesn't touch it either, but don't edit it without telling
Claude, both tracks depend on it staying stable), `apps/api/src/main.ts`,
`apps/api/src/app.module.ts`, `apps/api/src/modules/auth/**`,
`apps/api/src/modules/query/**`.

**`apps/api/src/app.module.ts`**: you don't touch this file. Once your
modules are ready, tell Claude — it'll add the import lines, or coordinate
with Codex if a same-time edit is needed. This is the one file both tracks
would otherwise collide on, so it's kept off both of your plates.

## Verifying your work

You need a working login to fully integration-test (Codex's `AuthModule`).
Once that exists, smoke-test with curl against `http://localhost:3000`:
register two users, raise a dispute on a transfer between them, resolve it
both ways (REJECT and REVERSE, including forcing the REVERSE-fails case by
having the receiver spend the money first), create a bill split three ways
and pay every share. After every write, check the ledger never drifts:

```sql
SELECT * FROM ledger.v_conservation;      -- total_paisa must always be 0
SELECT * FROM ledger.v_balance_drift;     -- must always return 0 rows
SELECT * FROM ledger.v_negative_accounts; -- must always return 0 rows
SELECT * FROM ledger.disputes ORDER BY id DESC LIMIT 5;   -- eyeball attempts/last_attempt_error after a forced-402
```

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching, HOLD/undo-window transfers, one-payer-many-payees split, load
testing, the simulator. Don't build these unless Claude asks.
