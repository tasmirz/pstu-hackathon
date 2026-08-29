# Backend Task Split — identifier: claude

Read `BUILD_LOG_CLAUDE.md` first for how we got here (three services → one
NestJS monolith, ports/adapters at module boundaries, three DB roles kept as
three `pg.Pool`s in one process). This file is the handoff: what exists, what
doesn't, and how to split the rest between two people without stepping on
each other.

**Everything below assumes infra is already up**: `docker compose up -d`,
then `node scripts/apply-schema.js` (idempotent — safe to re-run). RSA keys
at `infra/keys/{private,public}.pem` already generated.

---

## 1. What exists right now

```
apps/api/src/
  config.ts                                   env loading, all tunables
  db/db.module.ts                             AUTH_POOL / LEDGER_POOL / READ_POOL (3 roles, 1 process)
  common/
    all-exceptions.filter.ts                  AppError -> {error,message,details} wire shape
    decorators.ts                             @IdempotencyKey() @StepUpToken() @CurrentUser()
    idempotency.util.ts                       claimIdempotencyKey() / storeIdempotencyResponse()
    step-up.util.ts                           requireStepUp({userId, token, reason, always?, amountPaisa?})
    guards/jwt-auth.guard.ts                  RS256 verify + token_version check (logout-all works immediately)
    guards/admin.guard.ts                     req.user.role === 'ADMIN'
  modules/ledger/core/
    accounts.repository.ts                    getUserAccountId, getOrCreateHoldAccountId, getBalance, spentToday, dailyLimit
    users.repository.ts                       reads auth.users_public (id/phone/name/status/role/token_version)
    ledger-writer.port.ts + .service.ts        MoveMoneyPort — THE shared double-entry primitive. Read this file first.
    reversal-core.service.ts                  applyReversal() — CAS COMPLETED->REVERSED, then moveMoney mirrored
  modules/ledger/transfers/
    dto.ts, transfers.service.ts, transfers.controller.ts     POST /transfers — fully working logic, just needs wiring
  modules/ledger/reversals/
    reversals.service.ts, reversals.controller.ts             POST /transactions/:id/reverse — fully working logic
  modules/ledger/disputes/
    dto.ts                                     ONLY the DTOs exist. Service + controller: not written.
```

`packages/shared` (`@pstu/shared`, workspace package, already built): `AppError`
+ every typed subclass matching `API.md`'s error table, RS256 jwt helpers
(`signAccessToken`/`verifyAccessToken`/`signStepUpToken`/`verifyStepUpToken`),
`withTransaction(pool, fn)`, `sha256`/`canonical` for idempotency hashing,
`newTxnRef()`, money/taka helpers, shared DTO types. **Use these, don't
reinvent them** — e.g. every new error must be a subclass in
`packages/shared/src/errors.ts`, not an ad-hoc `throw new Error()`.

SQL: `SCHEMA.sql` (given) + `infra/sql/001_amendments_claude.sql`
(auth↔ledger cross-schema grants, `auth.users_public` view) +
`infra/sql/002_bills_and_role_claude.sql` (admin `role` column,
`ledger.bills` / `ledger.bill_shares` tables for the new shared-bill
feature). Read both amendment files' comments — they explain *why* each
grant exists, which matters if you need a new one.

## 2. What's missing — nothing currently boots

There is no `main.ts`, no `app.module.ts`, and **no `AuthModule` at all**.
Nobody can log in, so nothing else is testable, so this is the first thing
either track needs before doing anything else. Whoever picks up Track 1
below should do this first and push/share it before Track 2 starts writing
controllers that need `@UseGuards(JwtAuthGuard)`.

---

## 3. The two tracks

Both tracks depend on `modules/ledger/core/*` (read-only, don't edit it
without telling the other person) and on `packages/shared`. They touch
disjoint controllers/services, so they can run in parallel.

### Track 1 — Bootstrap, Auth, Query, Admin wiring

1. **`apps/api/src/main.ts` + `app.module.ts`** — standard Nest bootstrap:
   `ValidationPipe({whitelist:true, transform:true})`, `AllExceptionsFilter`,
   import `DbModule` (already global) + every feature module.
2. **`modules/auth/`** — does not exist, rebuild from this spec (it worked
   once, as a separate `auth-gateway` process, before the pivot — this is a
   faithful port, not new design):
   - `POST /auth/register` — `{phone, name, pin}` → bcrypt-hash the PIN
     (`bcryptjs`, cost from `config.bcryptCost`, currently 10) → one DB
     transaction on **`AUTH_POOL`** that (a) inserts `auth.users`, (b) inserts
     a `ledger.accounts` row `type='USER', balance=0` for the new id, (c)
     looks up the `SYSTEM_MINT` account, (d) inserts a `ledger.transactions`
     row `kind='SIGNUP_BONUS', state='COMPLETED', sender_id=NULL,
     receiver_id=<new user>, amount=config.signupBonusPaisa`, (e) inserts the
     two `ledger.entries` legs, (f) updates both account balances, (g)
     inserts an `outbox` row `topic='txn.completed'`. This works because
     `auth_svc` has narrow ledger grants for exactly this
     (`infra/sql/001_amendments_claude.sql` — read its comment). **Nowhere
     else does `AUTH_POOL` touch `ledger`.** Then issue an access+refresh
     token pair (see below) and return `{user, access_token, refresh_token,
     signup_bonus_paisa, balance_paisa}`.
   - `POST /auth/login` — `{phone, pin}`. Check `locked_until` first (423
     `ACCOUNT_LOCKED` if still in the future). `bcrypt.compare`. Wrong PIN:
     increment `failed_pin_attempts`; at `config.failedPinLockoutThreshold`
     (5), set `locked_until = now() + lockoutMinutes` and reset the counter,
     return 423; otherwise 401 with `attempts_remaining`. Right PIN: reset
     `failed_pin_attempts`/`locked_until`, issue tokens.
   - **Refresh rotation** (`POST /auth/refresh`) — raw token hashed with
     `sha256` and looked up in `auth.refresh_tokens` by `token_hash`. If the
     row's `consumed_at` OR `revoked_at` is already set, this is a replay:
     revoke every non-revoked row in that `family_id` and throw
     `TokenReuseDetected` (401). If expired, `Unauthenticated`. Otherwise:
     mark this row `consumed_at = now()`, insert a new row in the **same**
     `family_id`, return new tokens. `POST /auth/logout` revokes the
     presented token's family. `POST /auth/logout-all` (guarded) increments
     `auth.users.token_version` — the guard in `common/guards/jwt-auth.guard.ts`
     already checks this per-request, so this alone makes it immediate.
   - `GET /auth/me` (guarded) — `id, phone, name, status,
     totp_secret IS NOT NULL AS totp_enrolled`.
   - `POST /auth/pin/change` (guarded, step-up not required per API.md) —
     verify `current_pin`, hash `new_pin`, bump `token_version` (revokes
     other sessions), revoke all refresh token families for the user, return
     `sessions_revoked` count.
   - `POST /auth/step-up` (guarded) — **PIN method only** for now (`{method:
     'PIN', pin}` → bcrypt.compare → `signStepUpToken` from
     `@pstu/shared`, 120s). TOTP method: return `501 NOT_IMPLEMENTED` — it's
     explicitly deferred (§5).
   - `GET /auth/ws-token` (guarded) — stub is fine: sign `{sub: String(userId)}`
     with `config.centrifugoTokenSecret` (HMAC), return
     `{token, channel: 'user#'+userId, url: config.centrifugoWsUrl}`. Nothing
     consumes this yet (no Centrifugo bridge built) — don't over-invest here.
   - Token issuance helper: `signAccessToken(privateKey, {sub, tv,
     role})` from `@pstu/shared`, 15 min. Refresh token = `'rt_' +
     randomBytes(32).toString('base64url')`, store `sha256(raw)` +
     `family_id` (uuid, same one across a rotation chain) +
     `expires_at` (now + `config.refreshTokenTtlDays`).
3. **`modules/admin/`** — new:
   - `GET /admin/integrity` (guarded, `AdminGuard`) — run the three views
     `ledger.v_conservation`, `ledger.v_balance_drift`,
     `ledger.v_negative_accounts` (all already in `SCHEMA.sql`) and shape the
     response exactly as `API.md` §Admin shows. **On failure return the
     actual numbers/ids, never a bare `false`.**
   - `POST /admin/accounts/:id/freeze` / `/unfreeze` (guarded, step-up
     `always: true`, reason mandatory) — `UPDATE ledger.accounts`... no,
     `auth.users.status` (frozen is a user-status thing, checked in
     `LedgerWriterService.moveMoney` via `sender.status`). Write an
     `ledger.audit_log` row on every call (actor_id, actor_kind='ADMIN',
     action, entity='user', entity_id, before/after, and `reason` in
     `after` or a dedicated column — match `SCHEMA.sql`'s `audit_log`
     shape).
   - Dispute queue + resolve: **belongs to Track 2** (it's part of
     `DisputesService`; the admin controller just calls it behind
     `AdminGuard`). Coordinate who writes `modules/admin/admin.controller.ts`
     so you don't both touch it — simplest split: Track 1 owns
     `admin.controller.ts`'s freeze/integrity routes, Track 2 adds the
     dispute routes to the same file once it exists, or you each own a
     separate controller (`AdminIntegrityController` /
     `AdminDisputesController`) registered in the same `AdminModule`. Prefer
     separate controllers — zero merge risk.
4. **`modules/query/`** — new, uses **`READ_POOL`** only (never write):
   - `GET /accounts/me/balance` — `{balance_paisa, held_paisa, available_paisa}`.
     `held_paisa` = balance of the user's `HOLD` account if one exists, else 0
     (the HOLD account may not exist yet — nothing has created one, since the
     undo-window feature isn't built; this will just always be 0 for now,
     which is correct and worth a one-line comment, not a TODO panic).
   - `GET /accounts/me/limits` — `daily_limit_paisa` (from
     `ledger.limit_overrides` or `config.dailyLimitDefaultPaisa`),
     `spent_today_paisa` (same query as `AccountsRepository.spentToday`, but
     `READ_POOL` needs its own copy or a shared read-only repo — don't import
     `apps/api/src/modules/ledger/core/*` from Query; that repo is bound to
     `LEDGER_POOL` on purpose. Duplicate the ~5-line query rather than cross
     the pool boundary — that boundary is the whole point).
   - `GET /transactions?limit=&cursor=&direction=&kind=` — keyset pagination
     (`WHERE id < $cursor ORDER BY id DESC LIMIT $limit+1`, `has_more` = got
     an extra row, `next_cursor` = last returned id or null).
   - `GET /transactions/:id` — include `entries` (both legs, join
     `ledger.entries`) and `can_reverse` (`state='COMPLETED' AND kind !=
     'REVERSAL' AND sender_id = current user`).
   - `GET /users/lookup?phone=` — from `auth.users_public`, shape name as
     "first name + last initial" per `API.md` (split on whitespace, first
     token + first letter of last token + `.`). `is_first_time` = no
     `COMPLETED` transaction exists yet between the two ids (same query
     `TransfersService` already runs — again, fine to duplicate a 3-line
     query across the pool boundary rather than share the module).

### Track 2 — Disputes, Bill Payment (1:1), Shared Bill Payment

Everything here lives under `modules/ledger/` (uses `LEDGER_POOL`) and
depends only on `modules/ledger/core/*`, which already exists.

1. **`modules/ledger/disputes/`** (`dto.ts` already written):
   - `raise(userId, txnId, reason)` — load the transaction, 404 if missing,
     `NotAParty` (403) unless `userId` is sender or receiver, `DisputeWindowClosed`
     (422) if `now() - created_at > config.disputeWindowDays` days. Insert into
     `ledger.disputes`; catch Postgres `error.code === '23505'` (the partial
     unique index `one_open_dispute_per_txn`) and rethrow as
     `DisputeAlreadyOpen` (409) — **do not** pre-check with a `SELECT` first,
     the whole point of that index is that the DB is the single source of
     truth for "already open," not an app-level `if`.
   - `listMine(userId)` — `SELECT * FROM ledger.disputes WHERE raised_by=$1
     ORDER BY id DESC`.
   - `listQueue(state, cursor, limit)` (admin) — join `transactions` +
     `auth.users_public` (sender/receiver names) and compute `reversible_now`
     as `receiver's USER account balance >= transaction.amount` at read
     time. **Advisory only** — never gate the actual resolve on this value.
   - `resolve(adminId, disputeId, action, resolution, idemKey, stepUpToken)`
     — `requireStepUp({userId: adminId, token: stepUpToken, reason:
     'ADMIN_ACTION', always: true})`. Then, inside `withTransaction`:
     `claimIdempotencyKey` (keyed on `adminId` — an admin's own idempotency
     namespace, separate from any user's), `SELECT ... FOR UPDATE` the
     dispute, 404/409 if missing/not-OPEN. `REJECT`: one CAS `UPDATE
     ledger.disputes SET state='REJECTED', resolution=$1, resolved_by=$2,
     resolved_at=now() WHERE id=$3 AND state='OPEN'`. `REVERSE`: call
     `ReversalCoreService.applyReversal(t, dispute.txn_id)` (**reuse this,
     don't reimplement reversal logic**), then CAS the dispute to
     `REVERSED` with `reversal_txn_id` set. Write one `ledger.audit_log` row
     either way. **Critical**: wrap the whole `withTransaction` call in a
     `try/catch` — if `applyReversal` throws `InsufficientFunds`, the
     transaction has already rolled back (dispute is untouched, still
     `OPEN`), so in the `catch` block run a **separate** query: `UPDATE
     ledger.disputes SET attempts = attempts + 1, last_attempt_at = now(),
     last_attempt_error = $1 WHERE id = $2`, then rethrow so the controller
     still returns 402. This two-phase shape (attempt inside a tx that can
     roll back, then record the failure in a tx that can't) is the one
     subtle part of this whole module — see PLAN.md §4.3 point 4 for why the
     dispute must stay genuinely `OPEN`, not move to some invented
     `REVERSAL_FAILED` state.
   - Controller: `POST /disputes`, `GET /disputes` (guarded, `JwtAuthGuard`
     only). Admin routes (`GET /admin/disputes`, `POST
     /admin/disputes/:id/resolve`) go in `modules/admin/` behind
     `AdminGuard` — see Track 1 note above about avoiding a controller
     merge conflict.

2. **`modules/ledger/requests/`** — "Bill Payment (1:1)", new module, thin:
   - `create(requesterId, fromPhone, amountPaisa, note)` — resolve phone,
     `mr_not_self` means `SelfTransfer` if it matches the requester, insert
     `ledger.money_requests` (`expires_at` = now + 24h, pick a value and put
     it in `config` rather than hardcoding it inline), state `PENDING`. No
     money moves, no idempotency key required (matches `API.md`).
   - `pay(payerId, requestId, idemKey, stepUpToken)` — inside
     `withTransaction`: claim idempotency key, `SELECT ... FOR UPDATE` the
     request, 404/409 if missing/not-PENDING/expired, confirm
     `payer_id === request.payer_id` (`NotAParty` otherwise). Call
     `ledgerWriter.moveMoney(t, {senderId: payerId, receiverId:
     request.requester_id, amountPaisa: request.amount, kind:
     'REQUEST_SETTLE', note: request.note})` — **reuse the same port
     Transfers uses**, don't hand-roll another double-entry write. CAS the
     request `PENDING -> PAID` with `settled_txn_id`. Apply the same
     amount-threshold/first-time-recipient step-up rules as Transfers
     (`requireStepUp`) — copy that logic from `TransfersService`, don't
     import it directly (it's tied to phone-based lookup there; here you
     already have a numeric `requester_id`).
   - `decline` / `cancel` / `remind` — straightforward CAS-off-`PENDING`
     endpoints per `API.md`. `remind` only queues a notification (there's no
     notification pipeline yet — make it a no-op that still enforces the
     once-per-hour rate limit via `reminded_at`, so the endpoint's contract
     is honest even though nothing consumes it yet).

3. **`modules/ledger/bills/`** — Shared Bill Payment, the new feature. Full
   endpoint shapes are in `API.md` §"Bill Payment" (just added). Tables:
   `ledger.bills` / `ledger.bill_shares` (`infra/sql/002_bills_and_role_claude.sql`).
   - `create(creatorId, title, shares: {phone, amountPaisa}[])` — resolve
     every phone (404 `USER_NOT_FOUND` if any miss), reject if any resolves
     to `creatorId` (`SelfTransfer`, 422), reject `< 2` shares or any
     `amountPaisa <= 0` (`ValidationError`, 400), reject duplicate phones in
     the same request (`ValidationError`). Insert `ledger.bills` with
     `total_amount = sum(shares)`, then one `ledger.bill_shares` row per
     share, all in one `withTransaction` — a partial failure here must not
     leave an orphaned bill with fewer shares than requested.
   - `pay(payerId, billId, idemKey, stepUpToken)` — inside
     `withTransaction`: claim idempotency key, `SELECT ... FOR UPDATE` the
     bill's share row for `(billId, payerId)` — 404
     `BILL_SHARE_NOT_FOUND` (new error, add it to
     `packages/shared/src/errors.ts`) if none, 409 `InvalidState` if not
     `PENDING`. Load the bill row too (need `created_by` and to check it's
     not `CANCELLED`). Apply step-up rules (same shape as Requests — amount
     threshold + first-time-recipient against `created_by`). Call
     `ledgerWriter.moveMoney(t, {senderId: payerId, receiverId:
     bill.created_by, amountPaisa: share.amount, kind:
     'BILL_SHARE_SETTLE', note: bill.title})`. CAS the share to `PAID` with
     `settled_txn_id`. Then check: `SELECT count(*) FROM
     ledger.bill_shares WHERE bill_id=$1 AND state != 'PAID'` — if zero,
     CAS the bill `OPEN -> SETTLED` in the same transaction. Return
     `{transaction, balance_paisa, bill: {id, state}}`.
   - **`BILL_SHARE_SETTLE` is a new `TxnKind`** — add it to the CHECK
     constraint in `ledger.transactions` (currently in `SCHEMA.sql`'s
     `txn_kind_chk`) via a new `infra/sql/003_*.sql` migration (`ALTER TABLE
     ledger.transactions DROP CONSTRAINT txn_kind_chk; ALTER TABLE ... ADD
     CONSTRAINT txn_kind_chk CHECK (kind IN (..., 'BILL_SHARE_SETTLE'))`),
     and to `TxnKind` in `packages/shared/src/types.ts`. **Do this before
     writing `BillsService.pay` or every insert will fail the CHECK.**
   - `listMine(userId, role: 'created'|'owed')`, `getById(billId)` — plain
     reads, fine to leave on `LEDGER_POOL` for now even though they're reads
     (txn_svc has SELECT on its own tables) rather than routing through
     Query — a straight port to `QueryModule` later is a one-file move, not
     urgent.
   - `cancel(creatorId, billId)` — P2, only if ahead. CAS every `PENDING`
     share to `CANCELLED`, bill to `CANCELLED`. Never touch a `PAID` share.

---

## 4. Conventions — please follow these, they're what makes both tracks composable

- **Every new error is a subclass in `packages/shared/src/errors.ts`**,
  never a raw `throw new Error()` or a bespoke Nest `HttpException` — the
  `AllExceptionsFilter` only special-cases `AppError`, and the wire shape
  (`{error, message, details}`) must stay identical everywhere.
- **Every money-writing method takes a `PoolClient` (`t`), not the `Pool`**,
  and is called from inside a `withTransaction(pool, async (t) => {...})` at
  the controller-facing service's top level — never open a second,
  independent transaction inside a method that's supposed to be atomic with
  its caller.
- **Idempotency claim happens FIRST**, before any other read/write in the
  transaction, via `claimIdempotencyKey` — see any of `TransfersService` /
  `ReversalsService` for the shape. If the claim says `isNew: false`, return
  its `response` immediately; don't re-run business logic.
- **CAS, never read-check-write**, for every state transition
  (`PENDING->PAID`, `OPEN->REVERSED`, etc.) — `UPDATE ... WHERE id=$1 AND
  state=$2 RETURNING *`, check `rowCount`. This is non-negotiable per
  PLAN.md §3.3; it's the only thing that's correct under concurrent
  requests, which is most of what a "trustworthy" grade will probe.
- **Reuse `LedgerWriterPort.moveMoney` for every double-entry write.**
  Nobody outside `modules/ledger/core/ledger-writer.service.ts` should
  `INSERT INTO ledger.entries` directly. If a case doesn't fit `moveMoney`'s
  params, extend the port rather than bypassing it.
- **Which pool for which module**: `AUTH_POOL` only in `modules/auth`,
  `LEDGER_POOL` only in `modules/ledger/**`, `READ_POOL` only in
  `modules/query`. Crossing this on purpose (reading `auth.users_public`
  from `LEDGER_POOL`) is fine — that's what the view is for — but never use
  `LEDGER_POOL` to write from a query-shaped endpoint or vice versa.

## 5. Explicitly out of scope right now (don't build unless asked)

HOLD/60-second-undo-window transfers, TOTP step-up, the Kafka outbox relay +
consumers, the Centrifugo bridge, Redis caching on Query, split-bill
(one-payer-many-payees — different from the shared-bill feature above),
scaling/load-testing, and the simulator (`sim/`, per `SIMULATOR.md` — not
started). These are real gaps, not accidents; they're deferred so the
priority list (disputes, bill payment, shared bill payment) lands first.

## 6. How to sanity-check your work without the simulator yet

No automated harness exists yet, so smoke-test with curl against
`http://localhost:3000` after `npm run start:dev -w apps/api`:
register two users, log in, hit your new endpoints, then check the ledger
never drifts:

```sql
SELECT * FROM ledger.v_conservation;      -- total_paisa must always be 0
SELECT * FROM ledger.v_balance_drift;     -- must always return 0 rows
SELECT * FROM ledger.v_negative_accounts; -- must always return 0 rows
```

Run those three after every manual test, not just at the end — a drift is
far easier to trace to the request that caused it if you check immediately.
