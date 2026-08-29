# Master Coordination — identifier: claude

Claude is acting as master over two agents working this backend in
parallel: **Codex** (`TASKS_CODEX.md`) and **Antigravity**
(`TASKS_ANTIGRAVITY.md`). This file tracks status and the one integration
point both of their task files deliberately avoid touching:
`apps/api/src/app.module.ts`. Full context for either track's rationale
lives in `BUILD_LOG_CLAUDE.md` (the three-services-to-one-monolith pivot)
and `API.md` (the Bill Payment section).

## Assignments

| Agent | Scope | Task file |
|---|---|---|
| Codex | Bootstrap (`main.ts`/`app.module.ts`), `AuthModule`, `QueryModule`, admin integrity/freeze | `TASKS_CODEX.md` |
| Antigravity | `DisputesService` (incl. admin resolve), Bill Payment 1:1 (`RequestsService`), Shared Bill Payment (`BillsService`) | `TASKS_ANTIGRAVITY.md` |

Both depend, read-only, on `apps/api/src/modules/ledger/core/*`
(`LedgerWriterPort`, `ReversalCoreService`, `AccountsRepository`,
`UsersRepository`) and on `packages/shared`, both already built. Neither
agent edits `app.module.ts` — that's assembled centrally (below) specifically
because it's the one file both task sets would otherwise collide on.

## Status

- [ ] Codex: bootstrap + `AuthModule` (blocking — nothing runs end-to-end until this lands)
- [ ] Codex: `QueryModule`
- [ ] Codex: `AdminModule` + `AdminIntegrityController`
- [ ] Antigravity: `DisputesModule` (+ `AdminDisputesController`, added to Codex's `AdminModule`)
- [ ] Antigravity: `RequestsModule` (Bill Payment 1:1)
- [ ] Antigravity: `BillsModule` (Shared Bill Payment)
- [ ] Claude: wire everything into `app.module.ts` once modules report ready
- [ ] Claude: smoke-test the full flow end to end, check `ledger.v_conservation` / `v_balance_drift` / `v_negative_accounts`

Update the checkboxes here as each piece lands — this file is the one place
that should always reflect current reality, since neither task file gets
rewritten mid-flight.

## Explicitly out of scope for both agents right now

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching on Query, HOLD/60-second-undo-window transfers, one-payer-many-payees
split, load testing, the simulator (`sim/`, per `SIMULATOR.md` — not
started). Deferred on purpose so the priority list (disputes, bill payment,
shared bill payment) lands first — don't let either agent wander into these.
