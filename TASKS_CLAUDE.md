# Master Coordination — identifier: claude

Claude is acting as master over two agents working this backend in
parallel: **Codex** (`TASKS_CODEX.md`) and **Antigravity**
(`TASKS_ANTIGRAVITY.md`). This file tracks status and the one integration
point both of their task files deliberately avoid touching:
`apps/api/src/app.module.ts`. Full context lives in `BUILD_LOG_CLAUDE.md`
(the three-services-to-one-monolith pivot) and `API.md` (Bill Payment
section).

## Status — checked 2026-08-29 ~13:20, against commit `df0dee5`

| Agent | Round | Status |
|---|---|---|
| Codex | Bootstrap + `AuthModule` + `QueryModule` + `AdminModule` | ❌ **not started** — blocking, see below |
| Antigravity | Round 1: Disputes, Bill Payment 1:1, Shared Bill Payment | ✅ **done, verified** — `node scripts/test-antigravity.js` all green, conservation holds |
| Antigravity | Round 2: HOLD / 60-second undo window | 🔵 assigned, in progress |

**Codex's task is genuinely blocking**, confirmed by inspection: no
`main.ts`, `app.module.ts`, `modules/auth`, `modules/query`, or
`modules/admin` exist on `main`. Concretely blocked on it right now:
Antigravity's `DisputesModule`/`RequestsModule`/`BillsModule` (built,
tested, sitting unimported), the existing `AdminDisputesController`
(written, unregistered — no `AdminModule` to host it), the frontend
(`frontend/`, already has login/send/history/disputes/bills/admin pages
scaffolded) has no real API to call, and nobody can log in to test anything
over HTTP. `TASKS_CODEX.md` has been updated with an urgency banner and the
now-current state of what's waiting on it.

Fixed while checking: `modules/ledger/transfers/` and
`modules/ledger/reversals/` (Claude's own earlier work) were missing their
`.module.ts` files — Codex's bootstrap would have failed to import them.
Added both (`transfers.module.ts`, `reversals.module.ts`), rebuilt
`apps/api` clean.

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

- [ ] Codex: bootstrap + `AuthModule` (blocking — nothing runs end-to-end until this lands)
- [ ] Codex: `QueryModule`
- [ ] Codex: `AdminModule` (+ registering the already-built `AdminDisputesController`)
- [x] Antigravity Round 1: `DisputesModule`, `RequestsModule`, `BillsModule` — done, verified
- [ ] Antigravity Round 2: HOLD/undo-window transfers
- [ ] Claude: wire everything into `app.module.ts` once Codex's bootstrap + Antigravity's modules are both ready
- [ ] Claude: end-to-end smoke test (register → transfer → dispute → bill → hold/cancel) + the three invariant views
- [ ] Frontend (`frontend/`, separate track, not covered by these task files): wire real API once Codex's bootstrap lands

Update this file as each piece lands — it's the one place that should
always reflect current reality, since the two task files aren't rewritten
mid-round.

## Explicitly out of scope for both agents right now

TOTP, the Kafka outbox relay actually running/consumers, the Centrifugo
bridge, Redis caching on Query, one-payer-many-payees split, load testing,
the simulator (`sim/`, per `SIMULATOR.md` — not started). Deferred on
purpose so the priority list lands first — don't let either agent wander
into these.
