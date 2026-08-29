# Build Log — claude

Running log of implementation work done by Claude. Newest entry on top.
Each entry: what changed, why, and current simulator board status if run.

Infra decision (confirmed with user): Postgres/Redis/Redpanda/Centrifugo run via
**Docker Compose** at all times (dev and test) — this also matches SIMULATOR.md's
chaos mechanisms which pause/kill these by container name. The three NestJS
application services (auth-gateway, txn-service, read-service) run **locally**
(`npm run start:dev`) against the dockerized infra during day-to-day development.
A separate compose profile containerizes the app services too, for full-stack
integration/load testing later. Nothing here is dockerized for scaling yet —
that's explicitly deferred until the user asks for it.

---

## 2026-08-29 — Session start

Read PLAN.md, API.md, SCHEMA.sql, SIMULATOR.md, and the problem statement.
Decided on repo layout:

```
docker-compose.yml         infra: postgres, pgbouncer, redpanda(+console), centrifugo, redis
packages/shared/           cross-service TS lib: pg pool w/ BIGINT parser, jwt, money, http errors
apps/txn-service/          NestJS — the ledger + transfer path (Plan §3.2, owner "A")
apps/auth-gateway/         NestJS — phone+PIN auth, JWT, step-up, routing (owner "B")
apps/read-service/         NestJS — SELECT-only queries, Kafka consumer, Redis cache, Centrifugo bridge
sim/                       scenario simulator per SIMULATOR.md (owner "C", built alongside features)
```

Build order (deviates from PLAN.md's 4-person parallel schedule since this is a
single-agent build): infra → schema → simulator invariants (pure SQL, no API
needed) → txn-service ledger core → simulator HAP/IDEM/VAL/CON scenarios →
auth-gateway → read-service → outbox relay + Kafka + Centrifugo + Redis cache →
P1 features (holds/undo, reversals, requests, disputes) → frontend.

Starting now.

**Scope note (user, mid-session):** another dev is building the UI. This build
covers backend only — auth-gateway, txn-service, read-service, infra, and the
simulator. No frontend work here.

## Schema amendment — `infra/sql/001_amendments_claude.sql`

SCHEMA.sql gives `txn_svc`/`read_svc` zero access to `auth` and `auth_svc` zero
access to `ledger`. Two flows can't work under that as written, so I added a
narrow, documented amendment on top (nothing in SCHEMA.sql itself is changed):

1. `auth.users_public` view `(id, phone, name, status)`, `SELECT` granted to
   `txn_svc` and `read_svc` — needed for phone→user resolution on transfers,
   `GET /users/lookup`, and counterparty names, without exposing `pin_hash`/
   `totp_secret` to services that have no business seeing credentials.
2. `auth_svc` gets narrow `ledger` grants (accounts, transactions, entries,
   outbox — insert/select, update only on `accounts.balance`) so the signup
   bonus can be one real Postgres transaction across the user-creation and
   the mint, per PLAN.md §3.5. General transfers stay exclusively
   `TransferService`'s job in `txn_svc` — this exception is scoped to signup only.

## Infra up, schema applied

- `docker compose up -d`: postgres:16, pgbouncer (edoburu/pgbouncer:latest —
  pinned `1.21.0` tag doesn't exist, switched to `latest`), redis:7-alpine,
  redpanda v24.2.7 (single-node dev mode) + redpanda-console on :8090,
  centrifugo v5. All healthy. Ports: pg :5432 (direct, migrations only),
  pgbouncer :6432 (apps connect here), redis :6379, redpanda :19092 (host
  clients), centrifugo :8000.
- RSA keypair generated at `infra/keys/{private,public}.pem`.
- `scripts/apply-schema.js` runs `SCHEMA.sql` then `infra/sql/*.sql` in order,
  directly against :5432 as the `postgres` owner role. Applied clean —
  `auth_svc`/`txn_svc`/`read_svc` roles created, partitions attached,
  `SYSTEM_MINT` seeded.
- `centrifugo/config.json` is a placeholder (HMAC secret, no real channel
  config yet) — will verify against actual v5 docs when the Centrifugo bridge
  is wired (Phase 2 item), not before.
- Root is an npm workspace: `packages/shared` (cross-service lib — pg pool w/
  the BIGINT type-parser fix, typed AppErrors matching API.md's error table,
  RS256 jwt helpers, money/hash/id helpers), `apps/*` (services), `sim`
  (simulator). `packages/shared` written; apps not yet scaffolded.

Built `apps/auth-gateway` (register/login/refresh-rotation-with-reuse-
detection/logout/logout-all/me/pin-change/step-up(PIN only)/ws-token stub +
reverse proxy to txn/read services) and `apps/txn-service` (the plain
`POST /transfers` path: idempotency claim-first, ascending-id lock order,
frozen/insufficient-funds/first-time-recipient-step-up/daily-limit checks,
outbox row in the same commit). Smoke-tested through the gateway end to end:
register → signup bonus is a real ledger txn → first-time step-up →
idempotent transfer → replay → reuse-with-different-body 422. Conservation,
drift, and negative-balance views all clean after.

## Pivot — user directive: single NestJS monolith, ports/adapters, priority features

Mid-session the user redirected: eval weighs real-life feature depth over
strict microservice topology. Keep the *architectural ideas* (double-entry
ledger, CQRS-shaped read/write split, DB-role-enforced boundaries, outbox)
but implement them as **one NestJS app, layered (controller → service →
repository), with ports/interfaces at the module boundaries** so the split
into auth-gateway/txn-service/read-service processes remains a mechanical
later step (swap a DI provider for an HTTP adapter) rather than a rewrite.
Postgres stays as-is, including the three DB roles (`auth_svc`/`txn_svc`/
`read_svc`) — a single process holding three separately-scoped `pg.Pool`s is
what keeps "structurally incapable of writing" true even before any process
split happens.

Consolidating `auth-gateway` + `txn-service` + `read-service` → `apps/api`,
one Nest app, modules `AuthModule` / `LedgerModule` / `QueryModule` /
`AdminModule`, each module's cross-module surface expressed as a
`*.port.ts` interface with an in-process adapter behind it today.

Priority features now (user's explicit list, more to come later):
1. **Dispute handling** — `ledger.disputes` already in SCHEMA.sql; building
   raise / admin queue / resolve(REVERSE|REJECT) per API.md §Admin and
   PLAN.md §4.3, including the "reversal fails, dispute stays OPEN" path.
2. **Bill payment** — one requester, one payer, pays a fixed amount on
   request. Reuses the existing `ledger.money_requests` table/flow.
3. **Multi-user shared bill payment** — NEW: one bill, several payers each
   owing their own share, bill settles once every share is paid. Not in
   SCHEMA.sql as given; adding `ledger.bills` + `ledger.bill_shares` (see
   `infra/sql/003_bills_claude.sql`). Each share settlement is an ordinary
   double-entry transfer (payer → bill creator), reusing the same
   lock-order/CAS/idempotency machinery as a plain transfer via a shared
   ledger-transfer primitive — this is the clearest illustration of the
   port/adapter seam in the whole build.

Deleting the three-service scaffolding's process boundary (proxy, three
`main.ts`s) but keeping every piece of logic already proven working above —
it moves into `apps/api`'s modules essentially unchanged.

## Docs + task split, per user request

User asked to split remaining backend work for another dev and to spec the
UI for dispute handling and multi-user bill payment (paid from the payer's
normal account, no escrow) — no further app code this round. Delivered:

- **`TASKS_CLAUDE.md`** — full handoff: what exists (file-by-file), what's
  missing to even boot (`main.ts`/`app.module.ts`/`AuthModule` — none exist
  yet), and a two-track split along module boundaries so two people can work
  without colliding: **Track 1** = bootstrap + `AuthModule` (spec'd in full
  detail since the code was deleted in the pivot and nothing on disk shows
  it) + `QueryModule` + admin integrity/freeze; **Track 2** = `DisputesService`
  (incl. the two-phase "reversal attempt can roll back, failure-recording
  can't" shape for §4.3), `RequestsService` ("Bill Payment 1:1"), and the new
  `BillsService` (shared bill payment). Both tracks depend only on
  `modules/ledger/core/*`, which already exists and is documented as
  read-only common ground.
- **`API.md`** — added a "Bill Payment" section: `POST /bills`,
  `GET /bills/mine`, `GET /bills/:id`, `POST /bills/:id/pay`,
  `POST /bills/:id/cancel` (P2). Clarified that "Bill Payment (1:1)" is just
  the existing Money Requests flow under a product name — no new endpoint
  there.
- **`UI_SPEC.md`** — added §6b (full raise-dispute flow, pulled out of the
  Transaction Detail modal into its own spec'd screen) and §6c (My Disputes
  tracking list — resolved disputes must show the admin's resolution text,
  never disappear). Added §11, Shared Bill Payment (create / detail-status-
  board / pay-my-share), explicitly built as a recombination of the Send and
  Money Requests screens — pay-my-share routes into Send's own confirm step
  rather than being a new flow, and the copy states plainly that payment
  comes out of the payer's ordinary balance, not a separate wallet. Updated
  the screen inventory table, the flow diagram, and the Phase-4 build order
  to include all of it.
- **`packages/shared`** — added `BillNotFound` / `BillShareNotFound` /
  `RequestNotFound` to `errors.ts`, added `BILL_SHARE_SETTLE` to `TxnKind`.
  Rebuilt clean.
- **`infra/sql/003_bill_share_settle_kind_claude.sql`** — extends
  `ledger.transactions`' `txn_kind_chk` to allow `BILL_SHARE_SETTLE`,
  required before `BillsService.pay` can insert that kind.
- **Fixed a latent idempotency bug in the migration chain itself**: 001 and
  002 both touched `auth.users_public`, and 001's version of the view was
  missing the `role` column 002 later added — re-running 001 after 002 (as
  `apply-schema.js` does on every invocation, by design) hit Postgres'
  "cannot drop columns from view" and would have broken a fresh install
  the moment both files ran together. Moved the `role` column + its final
  view definition entirely into 001 (before the view is first declared);
  002 now only adds the bills tables (with `IF NOT EXISTS`, so it's
  idempotent too). Verified: `node scripts/apply-schema.js` runs 001→002→003
  clean from the current DB state.

## Orchestration — Claude as master over Codex + Antigravity

User is running two more agents against this repo: **Codex** and
**Antigravity**. Claude coordinates: assigned each a disjoint slice of the
remaining backend work as a standalone task file, so neither needs the
other's live context to proceed.

- `TASKS_CODEX.md` — bootstrap (`main.ts`/`app.module.ts`), `AuthModule`
  (fully spec'd — code was deleted in the pivot, nothing on disk shows it),
  `QueryModule`, admin integrity/freeze.
- `TASKS_ANTIGRAVITY.md` — `DisputesService` (+ admin resolve, including the
  two-phase "reversal attempt can roll back, failure-recording can't" shape
  for §4.3), `RequestsService` (Bill Payment 1:1), `BillsService` (Shared
  Bill Payment).
- `TASKS_CLAUDE.md` — trimmed to a short master-coordination doc: the
  assignment table, a status checklist, and the one integration point kept
  off both agents' plates on purpose (`app.module.ts`, wired centrally once
  both report their modules ready, so two agents editing the same DI wiring
  file at once is structurally impossible rather than merely discouraged).

Each task file states its own file-ownership boundary explicitly (down to
which files can be created), points at the same shared, already-working
primitives (`LedgerWriterPort`, `ReversalCoreService`, `packages/shared`)
so nobody reimplements double-entry writing or idempotency handling, and
lists the same "explicitly out of scope" set so neither agent wanders into
deferred features (TOTP, Kafka relay, Centrifugo, Redis cache, HOLD/undo,
simulator).

Next: wait for Codex/Antigravity to report progress, then wire
`app.module.ts` and run an end-to-end smoke test + the three invariant
views.

## Checked in on Codex + Antigravity, reassigned

Pulled `main` (`df0dee5`) and verified against the actual repo rather than
task-file claims:

- **Antigravity**: `DisputesModule`, `RequestsModule`, `BillsModule` all
  landed, `apps/api` builds clean, and `node scripts/apply-schema.js` +
  `node scripts/test-antigravity.js` (their own end-to-end script, seeding
  users directly since Auth doesn't exist yet) passes every assertion —
  including the two-phase dispute-failure shape (§4.3) and all three
  invariant views (conservation, drift, negative balances) staying clean
  throughout. Genuinely solid work, verified, not just claimed.
- **Codex**: nothing landed — no `main.ts`, `app.module.ts`,
  `modules/auth`, `modules/query`, or `modules/admin`. This is now the
  single blocking item for the whole team: Antigravity's finished modules
  sit unimported, the existing `AdminDisputesController` has no
  `AdminModule` to register into, and `frontend/` (already scaffolded by
  someone else — login/send/history/disputes/bills/admin pages) has no real
  API to call.
- **Found and fixed my own gap**: `modules/ledger/transfers/` and
  `modules/ledger/reversals/` (written earlier this session) were missing
  their `.module.ts` files entirely — only controller/service/dto existed.
  Codex's bootstrap would have hit a missing-import wall on day one. Added
  `transfers.module.ts` and `reversals.module.ts` matching the provider
  pattern Antigravity already established (each feature module
  self-declares `AccountsRepository`/`UsersRepository`/`LedgerWriterService`
  rather than sharing a core module — harmless duplication, all stateless
  pool wrappers). Rebuilt `apps/api` clean.

Reassigned: **Codex** keeps the same task, now with an urgency banner
listing exactly what's waiting on it and the note that Antigravity's
modules should all be wired into `app.module.ts` now (not held back for
central integration — no reason to, they're done and tested). **Antigravity**
gets Round 2: HOLD / 60-second undo-window transfers (PLAN.md §4.2, the
"showpiece") — the one substantial P1 ledger feature still unbuilt, and
self-contained enough not to need Codex's Auth work to develop against
(same direct-DB-seed workaround as Round 1). Flagged the one real design
tension up front: `LedgerWriterService.moveMoney` currently only resolves
`USER`-type accounts, and HOLD legs need to move money into/out of a `HOLD`
account — gave two concrete extension options rather than letting them
discover the constraint mid-implementation.

`TASKS_CLAUDE.md` rewritten with a dated status table reflecting verified
(not claimed) state, and a checklist covering both rounds plus the
frontend's dependency on Codex.

## STOPPED HERE — user asked for a handoff mid-refactor

`apps/api` does **not run yet** — `main.ts`, `app.module.ts`, and the
`AuthModule` haven't been written in the new layout, so there is currently no
runnable app in the repo (the old three-service one was deleted as part of
the pivot). See the handoff message in the conversation for exactly what
exists, what's missing, and the recommended next steps. Nothing here is
broken, it's mid-transcription from the working three-service version into
the new module layout.
