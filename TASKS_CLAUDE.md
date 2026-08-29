# Master Coordination — identifier: claude

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

## Status — checked 2026-08-29 ~16:00, against `main` (post-merge, all pushed)

| Agent | Round | Status |
|---|---|---|
| Codex | Round 1: Bootstrap + `AuthModule` + `QueryModule` + `AdminModule` | ✅ **done, verified end-to-end** |
| Antigravity | Round 1: Disputes, Bill Payment 1:1, Shared Bill Payment | ✅ **done, verified** — `node scripts/test-antigravity.js` |
| Antigravity | Round 2: HOLD / 60-second undo window | ✅ **done, verified** — `node scripts/test-antigravity-round2.js` |
| DeepSeek | Round 1: core screen set in Stitch + `UI_SPEC.md` mapping | ✅ **done** — see `BUILD_LOG_DEEPSEEK.md` |
| Codex | Round 2: expose `reputation` via `GET /users/lookup` (+ admin endpoint) | ✅ **done, verified** — build clean, live `curl` matches the view exactly |
| Antigravity | Round 3: `LOW_REPUTATION_RECIPIENT` step-up enforcement | ✅ **done, verified** — `node scripts/test-antigravity-round3.js`, 8/8 |
| Claude | Wired `sim/harness/client.ts` + HAPPY/IDEMPOTENCY into `sim/run.ts`, fixed 3 real scenario bugs | ✅ **done** |
| Codex | Round 3: `sim/scenarios/validation.ts` (Auth/Query HTTP edge cases) | ✅ **done, verified** — 14/14 (VAL-01..08 transfer + VAL-09..14 auth/query, merged) |
| Antigravity | Round 4: `sim/scenarios/dispute.ts`/`bills.ts`/`requests.ts` (own modules over real HTTP) | ✅ **done, verified** — 11/11, 5/5, 5/5 |
| DeepSeek | Round 2: reputation UI + frozen banner + REVERSAL row | ✅ **done** — see `BUILD_LOG_DEEPSEEK.md` |
| Claude | Deduped `dispute.ts`/`disputes.ts` id collision, fixed `sim/harness/chaos.ts` docker-cwd bug, full non-chaos sim run | ✅ **done** — 68/81 (rest triaged below) |
| Codex | Round 4: fix real CONCURRENCY/HOLD/REVERSAL/LIMITS failures found by the full run | 🔵 **assigned, in progress — re-verified 2026-08-29 ~16:45, same 11 failures, no fix landed yet, left in place per user's call** |
| DeepSeek | Round 3: notification feed, duplicate-send guard state, admin simulator presentation, canonical-screen cleanup | 🔵 assigned |
| Antigravity | Round 5: `GET /money-requests/incoming` + `/outgoing` (documented, never built) | 🔵 assigned |
| Antigravity | Round 6: notification writes off `moveMoney` + `GET /notifications` (queued — start after R5) | 🔵 assigned |

**The whole backend boots and works end to end** — verified live: register
(real signup-bonus ledger txn) → login → balance → lookup → step-up →
transfer (plain + HOLD/undo) → reversals → disputes (+ admin resolve) →
money requests → shared bills → admin integrity → reputation (read +
enforcement), conservation holding throughout. Full non-chaos `sim` run:
**LEDGER 7/7, HAPPY 6/6, IDEMPOTENCY 6/6, VALIDATION 14/14, REQUESTS 5/5,
DISPUTE 12/12, AUTH 4/4, BILLS 5/5 — 59/59.** Remaining known failures
(CONCURRENCY 3/7, HOLD 3/5, REVERSAL 2/4, LIMITS 1/3) are triaged to
Codex's Round 4 — mostly stale scenario assumptions (HOLD-threshold amounts
expecting `201` instead of `202`, missing step-up tokens before a race) but
at least one real race worth checking (`CON-04`: cancel and sweeper-settle
both reporting success on the same HELD transfer). CHAOS is 2/3 after
Claude's docker-cwd fix; `CHA-01` (kill-Postgres-mid-transfer) is an
inherently timing-flaky infra test, not a priority.

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
| Codex | Fix real CONCURRENCY/HOLD/REVERSAL/LIMITS bugs found by the full sim run — scenario-vs-real-bug triage, minimal backend fix where the bug is real | `TASKS_CODEX.md` |
| Antigravity | R5: `GET /money-requests/incoming` + `/outgoing`. R6 (queued): notification rows off `moveMoney` (`ledger.outbox`/`notify.notifications` already existed in `SCHEMA.sql`, just never wired) + `GET /notifications` | `TASKS_ANTIGRAVITY.md` |
| DeepSeek | Notification feed, duplicate-send guard state, admin simulator presentation, canonical Stitch-screen cleanup | `TASKS_DEEPSEEK.md` |

Codex is the one agent working inside `transfers.service.ts`/
`reversals.service.ts` this round — Antigravity's told explicitly to stay
out of those files until Codex's fixes land, to avoid a collision on live
edits. DeepSeek's track (Stitch + `UI_SPEC.md`) never touches
`apps/api/**`, `frontend/**`, or `sim/**` — zero file overlap.

## Previous rounds — all done

| Agent | Scope | Outcome |
|---|---|---|
| Codex | `GET /users/lookup` reputation field (+ admin reputation endpoint) | done, verified |
| Antigravity | Reputation step-up rule in Transfers/Bills/Requests | done, verified (8/8) |
| Codex | `sim/scenarios/validation.ts` — Auth/Query HTTP edge cases | done, verified (14/14) |
| Antigravity | `sim/scenarios/dispute.ts`/`bills.ts`/`requests.ts` — own modules over real HTTP | done, verified (11/11, 5/5, 5/5) |
| DeepSeek | Reputation indicator + LOW step-up copy + frozen banner + REVERSAL row | done |

## Checklist

- [x] Codex R1: bootstrap + `AuthModule` + `QueryModule` + `AdminModule` — done, verified
- [x] Antigravity R1: `DisputesModule`, `RequestsModule`, `BillsModule` — done, verified
- [x] Antigravity R2: HOLD/undo-window transfers — done, verified
- [x] DeepSeek R1: core screen set + `UI_SPEC.md` Stitch mapping — done
- [x] Claude: `apps/api` wired, live end-to-end smoke test, `sim/` LEDGER group — done
- [x] Claude: reputation view + config + `API.md`/`UI_SPEC.md` contract — done
- [x] Codex R2: `reputation` field on `GET /users/lookup` — done, verified
- [x] Antigravity R3: `LOW_REPUTATION_RECIPIENT` step-up in Transfers/Bills/Requests — done, verified (8/8)
- [x] Claude: `sim/harness/client.ts` wired into `run.ts` + HAPPY/IDEMPOTENCY groups — done, fixed 3 scenario bugs found along the way
- [x] DeepSeek R2: reputation UI + frozen-banner + history-reversal-row backlog items — done
- [x] Codex R3: `sim/scenarios/validation.ts` (Auth/Query real-HTTP edge cases) — done, 14/14
- [x] Antigravity R4: `sim/scenarios/dispute.ts` + `bills.ts` + `requests.ts` (own modules over real HTTP) — done, 11/11 + 5/5 + 5/5
- [x] Claude: deduped `dispute.ts`/`disputes.ts`, fixed `chaos.ts` docker-cwd bug, full sim run (59/59 non-chaos-affected groups, chaos 2/3) — done
- [ ] Codex R4: fix real CONCURRENCY/HOLD/REVERSAL/LIMITS bugs the full run surfaced — re-checked, not yet landed, left running
- [ ] Antigravity R5: `GET /money-requests/incoming` + `/outgoing`
- [ ] Antigravity R6: notification writes off `moveMoney` + `GET /notifications` — queued behind R5
- [x] Claude: `infra/sql/006_notifications_claude.sql` — grants `txn_svc` write access to `notify.notifications`, applied
- [ ] DeepSeek R3: notification feed, duplicate-send guard state, admin simulator presentation, canonical-screen cleanup
- [ ] Frontend (`frontend/`, separate track, not covered by these task files): wire real API, including the new reputation field

Update this file as each piece lands — it's the one place that should
always reflect current reality, since the task files aren't rewritten
mid-round.

## Explicitly out of scope for all agents right now

TOTP, the Kafka outbox relay actually running/consumers, the Centrifugo
bridge, Redis caching on Query, one-payer-many-payees split, load testing.
Deferred on purpose so the priority list lands first.
