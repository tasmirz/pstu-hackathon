# Master Coordination — identifier: claude

Claude is acting as master over two agents working this backend in
parallel: **Codex** (`TASKS_CODEX.md`) and **Antigravity**
(`TASKS_ANTIGRAVITY.md`). This file tracks status and the one integration
point both of their task files deliberately avoid touching:
`apps/api/src/app.module.ts`. Full context lives in `BUILD_LOG_CLAUDE.md`
(the three-services-to-one-monolith pivot) and `API.md` (Bill Payment
section).

## Status — checked 2026-08-29 ~13:40, against local working tree (Codex committed nothing yet, delivered on disk)

| Agent | Round | Status |
|---|---|---|
| Codex | Bootstrap + `AuthModule` + `QueryModule` + `AdminModule` | ✅ **done, verified end-to-end** |
| Antigravity | Round 1: Disputes, Bill Payment 1:1, Shared Bill Payment | ✅ **done, verified** — `node scripts/test-antigravity.js` all green, conservation holds |
| Antigravity | Round 2: HOLD / 60-second undo window | 🔵 assigned, in progress |

**The whole app now boots and works.** `apps/api` builds clean, every
module (`AuthModule`, `QueryModule`, `TransfersModule`, `ReversalsModule`,
`DisputesModule`, `RequestsModule`, `BillsModule`, `AdminModule` — including
Antigravity's `AdminDisputesController`) is wired into `app.module.ts` and
maps its routes on boot. Claude ran a live end-to-end smoke test against the
real server: register (real signup-bonus ledger txn) → login → balance →
phone lookup → step-up → transfer (idempotent, real double-entry) → promote
to admin → `GET /admin/integrity` (conservation/drift/negative/chain all
`pass:true`) → `GET /admin/integrity` correctly `403`s for a non-admin. Then
ran `npm run sim -w sim` (the new LEDGER invariant group) against that same,
now-busier database — still 7/7 green. New migration
`infra/sql/004_admin_integrity_grants_codex.sql` (grants `txn_svc` SELECT on
the three integrity views) applied clean.

Also fixed while checking: `modules/ledger/transfers/` and
`modules/ledger/reversals/` (Claude's own earlier work) were missing their
`.module.ts` files — Codex's bootstrap would have failed to import them.
Added both (`transfers.module.ts`, `reversals.module.ts`) before Codex's
bootstrap needed them; no conflict.

## Assignments

| Agent | Scope | Task file |
|---|---|---|
| Codex | Bootstrap (`main.ts`/`app.module.ts`), `AuthModule`, `QueryModule`, admin integrity/freeze | `TASKS_CODEX.md` |
| Antigravity | Round 2: HOLD/undo-window transfers (Round 1 done) | `TASKS_ANTIGRAVITY.md` |

Both depend, read-only, on `apps/api/src/modules/ledger/core/*`
(`LedgerWriterPort`, `ReversalCoreService`, `AccountsRepository`,
`UsersRepository`) and on `packages/shared`, both already built. Neither
agent edits `app.module.ts` — that's assembled centrally once Codex's
bootstrap lands.

## Checklist

- [x] Codex: bootstrap + `AuthModule` — done, verified
- [x] Codex: `QueryModule` — done, verified
- [x] Codex: `AdminModule` (+ registering the already-built `AdminDisputesController`) — done, verified
- [x] Antigravity Round 1: `DisputesModule`, `RequestsModule`, `BillsModule` — done, verified
- [ ] Antigravity Round 2: HOLD/undo-window transfers
- [x] Claude: wire everything into `app.module.ts` — Codex did this directly, verified correct
- [x] Claude: end-to-end smoke test (register → login → balance → lookup → transfer → admin integrity) + the three invariant views — all clean
- [x] Claude: `sim/` scenario simulator, LEDGER group (`LED-01..07`) — 7/7, see `CLAUDE_BUILD_LOG.md`
- [ ] End-to-end smoke test of Disputes/Bills/Requests over real HTTP (only tested via Antigravity's direct-DB script so far — now that Auth is up, worth a real HTTP pass)
- [ ] `sim/harness/client.ts` + `HAP`/`IDEM`/`VAL`/`CON` scenario groups, now that the server is confirmed up
- [ ] Frontend (`frontend/`, separate track, not covered by these task files): wire real API now that it's live

Update this file as each piece lands — it's the one place that should
always reflect current reality, since the two task files aren't rewritten
mid-round.

## Explicitly out of scope for both agents right now

TOTP, the Kafka outbox relay actually running/consumers, the Centrifugo
bridge, Redis caching on Query, one-payer-many-payees split, load testing,
the simulator (`sim/`, per `SIMULATOR.md` — not started). Deferred on
purpose so the priority list lands first — don't let either agent wander
into these.
