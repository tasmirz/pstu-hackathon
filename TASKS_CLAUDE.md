# Master Coordination — identifier: claude

> **Redistribution update (2026-08-29):** DeepSeek's reputation/frozen/
> reversal design round and Codex's Auth/Query validation round are complete.
> The validation-file collision is resolved on `main`: transfer validation is
> `VAL-01..08`, Auth/Query/Admin validation is `VAL-09..14`, and the combined
> group is 14/14 green. New briefs are now in `TASKS_CODEX.md` (remaining
> non-chaos simulator/backend reliability sweep) and `TASKS_DEEPSEEK.md`
> (notification feed, duplicate-send state, admin simulator presentation,
> canonical Stitch-screen cleanup).

Claude is acting as master over three agents: **Codex** (`TASKS_CODEX.md`,
backend), **Antigravity** (`TASKS_ANTIGRAVITY.md`, backend), and
**DeepSeek** (`TASKS_DEEPSEEK.md`, Stitch UI design + `UI_SPEC.md`). This
file tracks status and the one integration point kept off the backend
agents' plates: `apps/api/src/app.module.ts` (Codex assembled it directly
in Round 1; further module additions get a quick check-in before either
backend agent edits it a second time). Full context lives in
`BUILD_LOG_CLAUDE.md` / `CLAUDE_BUILD_LOG.md` (the three-services-to-one-
monolith pivot, the reputation feature) and `API.md` (Bill Payment,
Reputation sections).

## Status — checked 2026-08-29 ~15:10, against `main` (post-merge, all pushed)

| Agent | Round | Status |
|---|---|---|
| Codex | Round 1: Bootstrap + `AuthModule` + `QueryModule` + `AdminModule` | ✅ **done, verified end-to-end** |
| Antigravity | Round 1: Disputes, Bill Payment 1:1, Shared Bill Payment | ✅ **done, verified** — `node scripts/test-antigravity.js` |
| Antigravity | Round 2: HOLD / 60-second undo window | ✅ **done, verified** — `node scripts/test-antigravity-round2.js` |
| DeepSeek | Round 1: core screen set in Stitch + `UI_SPEC.md` mapping | ✅ **done** — see `BUILD_LOG_DEEPSEEK.md` |
| Codex | Round 2: expose `reputation` via `GET /users/lookup` (+ admin endpoint) | ✅ **done, verified** — build clean, live `curl` matches the view exactly |
| Antigravity | Round 3: `LOW_REPUTATION_RECIPIENT` step-up enforcement | ✅ **done, verified** — `node scripts/test-antigravity-round3.js`, 8/8 |
| Claude | Wired `sim/harness/client.ts` + HAPPY/IDEMPOTENCY into `sim/run.ts`, found & fixed 3 real scenario bugs | ✅ **done** — `sim` is 19/19 |
| DeepSeek | Round 2: reputation UI + backlog cleanup | 🔵 assigned |
| Codex | Round 3: `sim/scenarios/validation.ts` (Auth/Query HTTP edge cases) | 🔵 assigned |
| Antigravity | Round 4: `sim/scenarios/disputes.ts` + `bills.ts` (their own modules over real HTTP) | 🔵 assigned |

**The whole backend boots and works end to end** — verified live: register
(real signup-bonus ledger txn) → login → balance → lookup → step-up →
transfer (plain + HOLD/undo) → reversals → disputes (+ admin resolve) →
money requests → shared bills → admin integrity → reputation (read +
enforcement), conservation holding throughout. `sim/` now drives real HTTP,
not just SQL: **LEDGER 7/7, HAPPY 6/6, IDEMPOTENCY 6/6 — 19/19, 0 failed.**

## New feature this round: Reputation

A derived, read-only trust score per user (`0`–`100`, tiers
`EXCELLENT`/`GOOD`/`FAIR`/`LOW`), computed from completed transaction
count, account age, disputes-involved-in-that-resolved-REVERSED, and
frozen status. Built by Claude: `ledger.v_user_reputation`
(`infra/sql/005_reputation_claude.sql`, applied, granted to `read_svc` +
`txn_svc`), `config.reputationStepUpThreshold` (default `30`), full
contract in `API.md` §"Reputation" including the honest fault-attribution
limitation. Split three ways along the same lines as every other feature:
Codex exposes the *read* (Query), Antigravity adds the *enforcement*
(ledger step-up rule), DeepSeek designs the *UI* (badge/chip + a new
step-up copy variant). See each agent's task file for specifics — deliberately
non-overlapping files, no new integration point needed beyond what already
exists.

## Assignments — current round

| Agent | Scope | Task file |
|---|---|---|
| Codex | `sim/scenarios/validation.ts` — Auth/Query HTTP edge cases (bad PIN, token reuse, 404 lookup, non-admin 403, duplicate register) | `TASKS_CODEX.md` |
| Antigravity | `sim/scenarios/disputes.ts` + `bills.ts` — their own modules exercised over real HTTP (guards, step-up, DTO validation) for the first time | `TASKS_ANTIGRAVITY.md` |
| DeepSeek | Reputation indicator across Send/Request/Bill screens + Dashboard frozen state + History reversal row | `TASKS_DEEPSEEK.md` |

Both backend agents are writing pure scenario files against a client
(`sim/harness/client.ts`) that already has every method they need — no new
endpoints, no shared-file contention. Claude wires each new scenario group
into `sim/run.ts`'s `GROUPS` map once it lands (the one shared file,
same as always). DeepSeek's track (Stitch + `UI_SPEC.md`) never touches
`apps/api/**`, `frontend/**`, or `sim/**` — zero file overlap.

## Previous round (reputation) — all done

| Agent | Scope | Task file |
|---|---|---|
| Codex | `GET /users/lookup` reputation field (+ optional admin reputation endpoint) | `TASKS_CODEX.md` (superseded above) |
| Antigravity | Reputation step-up rule in Transfers/Bills/Requests | `TASKS_ANTIGRAVITY.md` (superseded above) |

## Checklist

- [x] Codex R1: bootstrap + `AuthModule` + `QueryModule` + `AdminModule` — done, verified
- [x] Antigravity R1: `DisputesModule`, `RequestsModule`, `BillsModule` — done, verified
- [x] Antigravity R2: HOLD/undo-window transfers — done, verified
- [x] DeepSeek R1: core screen set + `UI_SPEC.md` Stitch mapping — done
- [x] Claude: `apps/api` wired, live end-to-end smoke test, `sim/` LEDGER group — done
- [x] Claude: reputation view + config + `API.md`/`UI_SPEC.md` contract — done
- [x] Codex R2: `reputation` field on `GET /users/lookup` — done, verified
- [x] Antigravity R3: `LOW_REPUTATION_RECIPIENT` step-up in Transfers/Bills/Requests — done, verified (8/8)
- [x] Claude: `sim/harness/client.ts` wired into `run.ts` + HAPPY/IDEMPOTENCY groups — done, 19/19, fixed 3 scenario bugs found along the way
- [ ] DeepSeek R2: reputation UI + frozen-banner + history-reversal-row backlog items
- [ ] Codex R3: `sim/scenarios/validation.ts` (Auth/Query real-HTTP edge cases)
- [ ] Antigravity R4: `sim/scenarios/disputes.ts` + `bills.ts` (their modules over real HTTP)
- [ ] Frontend (`frontend/`, separate track, not covered by these task files): wire real API, including the new reputation field

Update this file as each piece lands — it's the one place that should
always reflect current reality, since the task files aren't rewritten
mid-round.

## Explicitly out of scope for all agents right now

TOTP, the Kafka outbox relay actually running/consumers, the Centrifugo
bridge, Redis caching on Query, one-payer-many-payees split, load testing.
Deferred on purpose so the priority list lands first.
