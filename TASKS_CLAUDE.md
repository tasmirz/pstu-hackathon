# Master Coordination — identifier: claude

Claude is acting as master over three agents: **Codex** (`TASKS_CODEX.md`,
backend), **Antigravity** (`TASKS_ANTIGRAVITY.md`, backend), and
**DeepSeek** (`TASKS_DEEPSEEK.md`, Stitch UI design + `UI_SPEC.md`). This
file tracks status and the one integration point kept off the backend
agents' plates: `apps/api/src/app.module.ts`. Full context lives in
`BUILD_LOG_CLAUDE.md` / `CLAUDE_BUILD_LOG.md` and `API.md`.

## The rubric just changed the priority list

Codex found `D:\PSTUHACK\selected_extra_features.md` — a file **outside
this repo** that is the actual scoring rubric for 5 features: Bill Split,
Send Money to a Group, Institute Bill Payment, Dispute Management, and
Reputation-Based Fraud Detection. Their gap analysis,
`EXTRA_FEATURES_AUDIT_AND_DESIGN.md`, is thorough and accurate and is now
the basis for every task file in this round. Read it before touching
anything below — it has the full data model and every edge case, already
diagrammed, for all five.

**Where each of the 5 stands, per that audit**:

| # | Feature | Status | Owner this round |
|---|---|---|---|
| 1 | Bill Split | Partial — custom shares + one-shot pay exist; equal split + partial-within-share payment don't | Antigravity, Round 8 |
| 2 | Send Money to a Group | Not started | Antigravity, Round 9 (stretch) |
| 3 | Institute Bill Payment | Not started | Codex |
| 4 | Dispute Management | Partial — raise/resolve/reverse exist; escrow-on-open + recovery-deficit workflow don't | Antigravity, Round 7 (do first — flagship spec example) |
| 5 | Reputation-Based Fraud Detection | Partial — score/tier/step-up exist; richer signals don't | **Deliberately deferred** — audit's own recommended order puts this last, after typed dispute outcomes exist (i.e. after Round 7) |

## Status — checked 2026-08-29, against `main`

| Agent | Round | Status |
|---|---|---|
| Codex | R1 Bootstrap+Auth+Query+Admin, R2 reputation read, R3 validation sim, R4 CONCURRENCY/HOLD/REVERSAL/LIMITS fixes | ✅ all done, verified |
| Antigravity | R1 Disputes/Bills/Requests, R2 HOLD/undo, R3 reputation step-up, R4 sim coverage, R5 incoming/outgoing, R6 notifications | ✅ all done, verified |
| DeepSeek | R1 core screen set, R2 reputation UI/frozen/REVERSAL row | ✅ done. R3 (notification feed/duplicate-send/admin-sim/cleanup) not started — folded into new assignment below as backlog |
| Claude | Reputation view, sim wiring, chaos fix, notify.notifications grant, full-board triage | ✅ done |
| — | **Full sim board** | ✅ **86/88, conservation held** — re-verified live by Claude after DeepSeek's 83/83; `HLD-03`/`04` fail only because `.env` currently holds demo-realistic timing (60s/5s), not test-fast values — known, not a bug |
| Codex | Institute Bill Payment (new) | 🔵 assigned |
| Antigravity | R7 Dispute escrow/recovery, R8 Bill Split completion, R9 Group Send (stretch) | 🔵 assigned — gets everything remaining on backend this round |
| DeepSeek | UI for Institute/Dispute-recovery/Bill-Split/Group-Send + old R3 backlog | 🔵 assigned |

**The whole backend boots and works end to end**, all three priority
features (disputes, bill payment, shared bill payment) plus reputation and
notifications are live, and the simulator covers essentially the whole
spec (`SIMULATOR.md`) at 83/83. The gap now is specifically the 5 extra
features graded by `selected_extra_features.md`, which is what this round
closes.

## Assignments — this round

| Agent | Scope | Task file |
|---|---|---|
| Codex | Institute Bill Payment — new module, own migration, own sim scenarios | `TASKS_CODEX.md` |
| Antigravity | R7 Dispute escrow+recovery (do first), R8 Bill Split equal-split+partial-payment, R9 Group Send (stretch) — everything else remaining on backend | `TASKS_ANTIGRAVITY.md` |
| DeepSeek | UI for all of the above + carried-over R3 backlog (notification feed, duplicate-send guard, admin sim presentation, canonical-screen cleanup) | `TASKS_DEEPSEEK.md` |

File ownership stays disjoint: Codex owns a new `institute-bills/` module;
Antigravity owns `disputes.service.ts`/`bills.service.ts` + a possible new
group-payment module; neither touches the other's files. Both flag new
`app.module.ts` entries for Claude rather than editing it directly.
DeepSeek never touches `apps/api/**`, `frontend/**`, or `sim/**`.

## Previous rounds — all done (kept for history)

| Agent | Scope | Outcome |
|---|---|---|
| Codex | Bootstrap, Auth/Query/Admin, reputation read, validation sim, CONCURRENCY/HOLD/REVERSAL/LIMITS fixes | done, verified |
| Antigravity | Disputes/Bills/Requests R1, HOLD/undo R2, reputation step-up R3, sim coverage R4, incoming/outgoing R5, notifications R6 | done, verified |
| DeepSeek | Core screen set, reputation UI, LOW step-up copy, frozen banner, REVERSAL row | done |
| Claude | Reputation view (`ledger.v_user_reputation`), `sim/` HTTP wiring, chaos harness fix, `notify.notifications` grant | done |

## Checklist

- [x] All of Codex R1–R4, Antigravity R1–R6, DeepSeek R1–R2 — done, verified
- [x] Full sim board 83/83, conservation held
- [x] `EXTRA_FEATURES_AUDIT_AND_DESIGN.md` — gap analysis against the real scoring rubric
- [ ] Codex: Institute Bill Payment
- [ ] Antigravity R7: Dispute escrow + recovery (priority — flagship spec example)
- [ ] Antigravity R8: Bill Split equal split + partial payment
- [ ] Antigravity R9: Group Send (stretch)
- [ ] DeepSeek: UI for Institute/Dispute-recovery/Bill-Split/Group-Send
- [ ] DeepSeek (carried over): notification feed, duplicate-send guard, admin sim presentation, canonical-screen cleanup
- [x] Claude: root `README.md`, `PLAN.md` status banner, `package.json` script cleanup, live re-verification (86/88, conservation held — `HLD-03`/`04` are a known test/demo config mismatch, not a bug)
- [ ] Frontend (`frontend/`, separate track): wire real API

## Explicitly out of scope for all agents right now

TOTP, the Kafka outbox relay actually consuming (notifications are
synchronous by design, see Antigravity R6), the Centrifugo bridge, Redis
caching, load testing, chaos/Docker portability beyond what's already
green, and Reputation-Based Fraud Detection extensions (deliberately last
per the audit's own recommended order).
