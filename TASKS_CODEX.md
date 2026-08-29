> **STATUS UPDATE from master (Claude), checked 2026-08-29 ~13:20** — this
> task has not landed yet (no `main.ts`, `app.module.ts`, `modules/auth`,
> `modules/query`, or `modules/admin` exist on `main` as of commit
> `df0dee5`). It is now the **single blocking item for the whole team**:
> Antigravity's Disputes/Requests/Bills modules are done, self-verified
> (`node scripts/test-antigravity.js` — all green, conservation holds), and
> sitting unregistered because there's no `app.module.ts` to wire them into;
> `AdminDisputesController` (Antigravity's) can't be mounted without your
> `AdminModule`; and the frontend (`frontend/`, already scaffolded with
> login/send/history/disputes/bills/admin pages) has nothing real to call.
> **This is still your assignment, unchanged, just louder: please prioritize
> §1 and §2 (bootstrap + AuthModule) above everything else in this file** —
> §3/§4 (Query, admin integrity/freeze) matter but don't block anyone else
> the way Auth does. Push early and often rather than batching everything
> into one commit, so the rest of the team can integrate incrementally.

# Assignment: Codex — Bootstrap, Auth, Query, Admin

You are one of two agents working this backend in parallel, coordinated by
Claude (acting as master — final integration into `app.module.ts` and any
cross-cutting conflict resolution goes through Claude, not you or the other
agent). The other agent, Antigravity, is working `TASKS_ANTIGRAVITY.md` at
the same time: Disputes, Bill Payment (1:1), and Shared Bill Payment. Your
two task sets touch **disjoint files** — see "Ownership boundaries" at the
bottom before you start, so neither of you needs to wait on the other.

Read `BUILD_LOG_CLAUDE.md` in full first for how this repo got here (three
services → one NestJS monolith, ports/adapters at module boundaries, three
DB roles kept as three `pg.Pool`s in one process). Do not re-litigate that
decision — it's settled.

**Infra is already up**: `docker compose up -d`, then
`node scripts/apply-schema.js` (idempotent, safe to re-run any time). RSA
keys already exist at `infra/keys/{private,public}.pem`.

---

## What already exists — read before writing anything

```
apps/api/src/
  config.ts                                   env loading, every tunable already named
  db/db.module.ts                             AUTH_POOL / LEDGER_POOL / READ_POOL, @Global
  common/
    all-exceptions.filter.ts                  AppError -> {error,message,details}
    decorators.ts                             @IdempotencyKey() @StepUpToken() @CurrentUser()
    idempotency.util.ts                       claimIdempotencyKey() / storeIdempotencyResponse()
    step-up.util.ts                           requireStepUp({userId, token, reason, always?, amountPaisa?})
    guards/jwt-auth.guard.ts                  RS256 verify + token_version check
    guards/admin.guard.ts                     req.user.role === 'ADMIN'
  modules/ledger/core/                        DO NOT EDIT — shared with Antigravity, read-only for you
    accounts.repository.ts, users.repository.ts, ledger-writer.port.ts/.service.ts, reversal-core.service.ts
  modules/ledger/transfers/                   working: POST /transfers
  modules/ledger/reversals/                   working: POST /transactions/:id/reverse
```

`packages/shared` (`@pstu/shared`, already built — `npm run build -w
packages/shared` after any change) exports every `AppError` subclass
matching `API.md`'s error table, RS256 jwt helpers (`signAccessToken`,
`verifyAccessToken`, `signStepUpToken`, `verifyStepUpToken`),
`withTransaction`, `sha256`/`canonical`, `newTxnRef`, money helpers, shared
DTO types. **Use these. Never `throw new Error()` for anything user-facing,
and never define a competing token/hash helper.**

SQL: `SCHEMA.sql` (given) + `infra/sql/001_amendments_claude.sql` (the
`auth.users_public` view, the `role` column, cross-schema grants) +
`infra/sql/002_bills_and_role_claude.sql` (Antigravity's tables — ignore) +
`infra/sql/003_bill_share_settle_kind_claude.sql` (ditto). Read `001`'s
comments if you need to understand why `auth_svc` can touch `ledger` at all
— it's a narrow, deliberate exception for the signup bonus only.

---

## Your deliverables

### 1. Bootstrap — `apps/api/src/main.ts` + `apps/api/src/app.module.ts`

Nothing currently boots. Standard Nest bootstrap:
`ValidationPipe({whitelist:true, transform:true})`, `AllExceptionsFilter`
as a global filter, `app.enableCors()`, listen on `config.port`.

**Update from master**: Antigravity's track is done and verified
(`node scripts/test-antigravity.js` passes end to end), so wire **all** of
the following into `app.module.ts`'s `imports`, not just your own —
there's no reason to hold these back now: `TransfersModule` and
`ReversalsModule` (`../modules/ledger/transfers` / `.../reversals` — module
files for these were missing and have been added by Claude, just import
them), `DisputesModule`, `RequestsModule`, `BillsModule` (all three under
`../modules/ledger/{disputes,requests,bills}`, built by Antigravity). Plus
`DbModule` (already `@Global`, but list it for clarity) and whatever you
build below (`AuthModule`, `QueryModule`, `AdminModule`).

### 2. `modules/auth/` — does not exist yet, build it

This ran once, correctly, as a separate `auth-gateway` process before the
pivot to one app — it was deleted, not abandoned. This is a faithful port
of a design that already worked, not new design:

- **`POST /auth/register`** — `{phone, name, pin}` → bcrypt-hash the PIN
  (`bcryptjs`, cost `config.bcryptCost`, currently 10) → one DB transaction
  on **`AUTH_POOL`** that: (a) inserts `auth.users`; (b) inserts a
  `ledger.accounts` row `type='USER', balance=0` for the new id; (c) looks
  up the `SYSTEM_MINT` account (`SELECT id FROM ledger.accounts WHERE
  type='SYSTEM_MINT'`); (d) inserts `ledger.transactions`
  `kind='SIGNUP_BONUS', state='COMPLETED', sender_id=NULL, receiver_id=<new
  user>, amount=config.signupBonusPaisa`; (e) inserts the two
  `ledger.entries` legs (mint account debited, new account credited); (f)
  updates both account balances; (g) inserts an `outbox` row
  `topic='txn.completed'`. This works because `auth_svc` has narrow ledger
  grants for exactly this (`infra/sql/001_amendments_claude.sql`) —
  **nowhere else should `AUTH_POOL` touch `ledger`.** Issue a token pair
  (below), return `{user, access_token, refresh_token, signup_bonus_paisa,
  balance_paisa}`.
- **`POST /auth/login`** — `{phone, pin}`. Check `locked_until` first (423
  `AccountLocked` if still future). `bcrypt.compare`. Wrong PIN: increment
  `failed_pin_attempts`; at `config.failedPinLockoutThreshold` (5), set
  `locked_until = now() + lockoutMinutes`, reset the counter, throw
  `AccountLocked`; otherwise `Unauthenticated` with `attempts_remaining` in
  `details`. Right PIN: reset `failed_pin_attempts`/`locked_until`, issue
  tokens.
- **Refresh rotation `POST /auth/refresh`** — hash the raw token with
  `sha256`, look up `auth.refresh_tokens` by `token_hash`. If `consumed_at`
  OR `revoked_at` is already set: this is a replay — revoke every
  non-revoked row in that `family_id`, throw `TokenReuseDetected`. If
  expired, `Unauthenticated`. Otherwise: mark this row `consumed_at =
  now()`, insert a new row in the **same** `family_id`, return new tokens.
- **`POST /auth/logout`** revokes the presented token's family.
  **`POST /auth/logout-all`** (guarded) increments `auth.users.token_version`
  — `JwtAuthGuard` already checks this per-request, so this alone makes it
  immediate everywhere.
- **`GET /auth/me`** (guarded) — `id, phone, name, status,
  totp_secret IS NOT NULL AS totp_enrolled`.
- **`POST /auth/pin/change`** (guarded) — verify `current_pin`, hash
  `new_pin`, bump `token_version`, revoke all refresh-token families for
  the user, return `{sessions_revoked}`.
- **`POST /auth/step-up`** (guarded) — **PIN method only.** `{method:'PIN',
  pin}` → `bcrypt.compare` → `signStepUpToken(config.jwtPrivateKey,
  {sub:userId, method:'PIN'})`, 120s. `{method:'TOTP', ...}` → throw `new
  AppError(501, 'NOT_IMPLEMENTED', 'TOTP step-up is not implemented')` —
  it's deliberately deferred, don't build it.
- **`GET /auth/ws-token`** (guarded) — stub: sign `{sub: String(userId)}`
  with `config.centrifugoTokenSecret` (plain HMAC via `jsonwebtoken`),
  return `{token, channel: 'user#'+userId, url: config.centrifugoWsUrl}`.
  Nothing consumes this yet — don't over-invest.
- Token pair helper: `signAccessToken(config.jwtPrivateKey, {sub, tv,
  role})` from `@pstu/shared`, 15 min. Refresh token = `'rt_' +
  randomBytes(32).toString('base64url')`; store `sha256(raw)` +
  `family_id` (uuid, same value across a whole rotation chain) +
  `expires_at` (`now + config.refreshTokenTtlDays`).

Use **`AUTH_POOL`** exclusively in this module (never `LEDGER_POOL` or
`READ_POOL`).

### 3. `modules/query/` — new, `READ_POOL` only, never writes

- **`GET /accounts/me/balance`** — `{balance_paisa, held_paisa,
  available_paisa}`. `held_paisa` = balance of the user's `HOLD` account if
  one exists, else `0` — nothing creates a HOLD account yet (the undo-window
  feature isn't built), so this will always read `0` for now. That's
  correct, not a bug — say so in a one-line comment, don't leave a TODO that
  looks broken.
- **`GET /accounts/me/limits`** — `daily_limit_paisa` (from
  `ledger.limit_overrides` or `config.dailyLimitDefaultPaisa`),
  `spent_today_paisa` (same shape query as
  `modules/ledger/core/accounts.repository.ts`'s `spentToday` — duplicate
  the ~5-line query here rather than importing across the pool boundary;
  that boundary is the point, not an accident).
- **`GET /transactions?limit=&cursor=&direction=&kind=`** — keyset
  pagination: `WHERE id < $cursor ORDER BY id DESC LIMIT $limit+1`,
  `has_more` = got the extra row, `next_cursor` = last returned id or
  `null`.
- **`GET /transactions/:id`** — include `entries` (both legs, join
  `ledger.entries`) and `can_reverse` (`state='COMPLETED' AND kind !=
  'REVERSAL' AND sender_id = current user`).
- **`GET /users/lookup?phone=`** — from `auth.users_public`. Shape name as
  "first name + last initial" (split on whitespace, first token + first
  letter of last token + `.`). `is_first_time` = no `COMPLETED` transaction
  yet exists between the two ids (same 3-line query `TransfersService`
  already runs — fine to duplicate across the pool boundary).

### 4. `modules/admin/` — integrity + freeze only (dispute routes are Antigravity's)

- **`GET /admin/integrity`** (guarded, `AdminGuard`) — run
  `ledger.v_conservation`, `ledger.v_balance_drift`,
  `ledger.v_negative_accounts` (all in `SCHEMA.sql` already) and shape the
  response exactly as `API.md` §Admin shows. **On failure, return the
  actual numbers/ids, never a bare `false`.**
- **`POST /admin/accounts/:id/freeze`** / **`/unfreeze`** (guarded, step-up
  `always:true`, `reason` mandatory in the body) — `UPDATE auth.users SET
  status=...` on **`AUTH_POOL`** (status lives in `auth`, not `ledger` —
  `LedgerWriterService.moveMoney` already reads it via
  `auth.users_public`). Write one `ledger.audit_log` row per call
  (`actor_id`, `actor_kind='ADMIN'`, `action`, `entity='user'`,
  `entity_id`, `before`/`after`, reason folded into `after` or its own
  column — match `SCHEMA.sql`'s `audit_log` shape). `ledger.audit_log` is
  in the `ledger` schema, so this one write needs `LEDGER_POOL` — two pools
  in one method is fine, they just aren't in the same transaction (an
  admin action logging to a different schema's audit table isn't required
  to be atomic with the status flip; note this tradeoff in a comment if you
  want, don't over-engineer it).
- **Create `modules/admin/admin.module.ts` with a controller named
  `AdminIntegrityController`** (not a bare `AdminController`). **Antigravity
  already wrote `apps/api/src/modules/admin/admin-disputes.controller.ts`
  (`AdminDisputesController`, needs `DisputesModule`'s `DisputesService`
  injected) — it exists on disk right now, unregistered.** When you create
  `AdminModule`, import `DisputesModule` (from
  `../ledger/disputes/disputes.module.ts`, already built) and register
  **both** `AdminIntegrityController` and the existing
  `AdminDisputesController` in its `controllers` array — don't write a
  second dispute-admin controller, the working one is already there.

---

## Conventions — same ones Antigravity is following

- Every new error is a subclass in `packages/shared/src/errors.ts`, never a
  raw `Error`/`HttpException`.
- Money-writing methods take a `PoolClient`, called from inside
  `withTransaction(pool, async (t) => {...})` at the top of the
  controller-facing service — you don't have much of this in your track
  (auth's signup-bonus transaction and admin's status flip are the only
  writes), but follow the same shape.
- CAS, never read-check-write, for any state transition you touch.
- Which pool for which module: `AUTH_POOL` only in `modules/auth`,
  `READ_POOL` only in `modules/query`, `modules/admin` uses whichever pool
  matches the schema it's touching per-call (see above).

## Ownership boundaries (so you and Antigravity never touch the same file)

**Yours**: `apps/api/src/main.ts`, `apps/api/src/modules/auth/**`,
`apps/api/src/modules/query/**`, `apps/api/src/modules/admin/admin.module.ts`
+ `admin-integrity.controller.ts` + `admin-integrity.service.ts` (or
equivalent naming — just don't create a file Antigravity's spec below also
names). **Not yours**: `apps/api/src/modules/ledger/core/**` (read-only for
both of you), `apps/api/src/modules/ledger/disputes/**`,
`apps/api/src/modules/ledger/requests/**`, `apps/api/src/modules/ledger/bills/**`.

**`apps/api/src/app.module.ts`**: you create it (step 1) with what exists
at the time. Once Antigravity's modules are ready, tell Claude rather than
editing it again yourself if Antigravity might be mid-edit — in practice
this is a two-line diff, so just check with Claude before touching it a
second time.

If you need a new `AppError` subclass in `packages/shared/src/errors.ts`,
check `TASKS_ANTIGRAVITY.md` first (it already lists `BillNotFound`,
`BillShareNotFound`, `RequestNotFound` as pre-added) so you don't duplicate
one under a different name.

## Verifying your work

No simulator exists yet. Smoke-test with curl against
`http://localhost:3000` after `npm run start:dev -w apps/api`: register two
users, log in, exercise refresh rotation (call `/auth/refresh` twice with
the same token and confirm the second is `TOKEN_REUSE_DETECTED`), hit your
query endpoints. After every write, check the ledger never drifts:

```sql
SELECT * FROM ledger.v_conservation;      -- total_paisa must always be 0
SELECT * FROM ledger.v_balance_drift;     -- must always return 0 rows
SELECT * FROM ledger.v_negative_accounts; -- must always return 0 rows
```

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching, HOLD/undo-window transfers, one-payer-many-payees split, load
testing, the simulator. Don't build these unless Claude asks.
