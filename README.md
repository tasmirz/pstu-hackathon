# PSTU Hackathon — Money Movement App

A closed-ecosystem digital money platform: register, get a ৳100,000
signup bonus, send/request money, split bills, dispute a bad transfer,
and see the double-entry ledger that makes every one of those honest.
Built for the PSTU Hackathon (29 Aug 2026, 09:00–15:00) — see
`question/PSTU_Hackathon_Problem_Statement.md` for the original brief.

## What's actually running

One NestJS app (`apps/api`) against Postgres 16, behind Docker infra for
PgBouncer/Redis/Redpanda/Centrifugo. The system was **originally planned
as three services** (Auth Gateway / Txn Service / Read Service — see
`PLAN.md`) and was deliberately collapsed into one deployable mid-contest
once the eval criteria turned out to reward feature depth over service
count. The three-role least-privilege boundary from that original design
is still real, not simulated: `auth_svc`, `txn_svc`, and `read_svc` are
three separate Postgres roles with distinct grants, and the app holds
three separate connection pools (`AUTH_POOL`/`LEDGER_POOL`/`READ_POOL`) —
each module only ever touches its own pool, so splitting back into
separate processes later is "swap a DI provider for an HTTP call," not a
rewrite. Full reasoning: `BUILD_LOG_CLAUDE.md`'s "Pivot" entry.

## Why it's built this way

The core engineering bet, everywhere: **money is a fact recorded twice,
never a number that gets edited.** `ledger.entries` is append-only —
enforced by a Postgres `REVOKE`, not application discipline, so even a
bug can't quietly rewrite history. Every transfer is exactly two rows
that sum to zero; a reversal is a *new* pair of rows, never an edit to
the old one. `accounts.balance` is a cache kept in sync by triggers; the
entries are the truth, and `ledger.v_conservation`/`v_balance_drift`/
`v_negative_accounts` exist so that truth can be checked by SQL at any
time, not just trusted. Every mutating endpoint takes an
`Idempotency-Key` and claims it *before* doing anything else, so the one
frontend bug every payments app eventually ships — the double-tap — turns
into a replay, not a double debit.

## Features

**Priority three** (the pivot's explicit focus): 1:1 transfers with a
60-second undo window (`HELD` → auto-settle or user-cancel), disputes
(raise → admin review → compensating reversal, never an edit), and
shared bill payment (one bill, several payers, each paying from their own
normal account — no escrow). Plus: money requests, a derived read-only
reputation score (`ledger.v_user_reputation`, 0–100, feeds a step-up rule
for low-trust recipients — with an honestly-documented limitation: it
can't attribute fault in a dispute, so a reversal penalizes both parties),
step-up authentication (PIN, amount thresholds, first-time recipients),
admin freeze/unfreeze + a live ledger-integrity dashboard, and
notifications written synchronously off every money movement.

**In progress this round** — see `EXTRA_FEATURES_AUDIT_AND_DESIGN.md` for
the full gap analysis against the actual scoring rubric
(`selected_extra_features.md`, kept outside this repo): Institute Bill
Payment (deadline-based accept-before-cutoff payments), Dispute recovery
(secure funds on dispute open, refund what's recoverable, track the
deficit as a debt rather than fabricating money), Bill Split completion
(equal-split mode, safe partial payment within one share), and Send Money
to a Group (stretch — independent per-recipient outcomes, no
all-or-nothing batch). Check `TASKS_CLAUDE.md` for current status.

## Repo map

| Path | What it is |
|---|---|
| `apps/api` | The NestJS monolith — everything runs here |
| `packages/shared` | Errors, the `pg` pool factory (BIGINT type-parser fix included), SQL helpers used by every module |
| `sim` | The scenario simulator — see below |
| `frontend` | A separate Next.js app/track, not covered by this backend work |
| `SCHEMA.sql` + `infra/sql/*.sql` | The full schema, applied in order by `scripts/apply-schema.js` |
| `PLAN.md` | Original architecture/schedule design (see its status banner) |
| `API.md` | Every endpoint, request/response shape, error code |
| `UI_SPEC.md` | Every screen, state, and interaction (Stitch mocks referenced by screen id) |
| `SIMULATOR.md` | The scenario harness spec |
| `EXTRA_FEATURES_AUDIT_AND_DESIGN.md` | Gap analysis against the actual scoring rubric |
| `TASKS_CLAUDE.md` / `TASKS_CODEX.md` / `TASKS_ANTIGRAVITY.md` / `TASKS_DEEPSEEK.md` | Multi-agent coordination — current status and assignments |
| `BUILD_LOG_CLAUDE.md`, `BUILD_LOG_ANTIGRAVITY.md`, `BUILD_LOG_DEEPSEEK.md` | Running narrative logs, newest entry on top |

## Running it

Infra is always Docker; the app runs locally against it.

```bash
npm install
npm run infra:up          # Postgres, PgBouncer, Redis, Redpanda, Centrifugo
npm run db:apply          # SCHEMA.sql + every infra/sql/*.sql amendment, in order, idempotent
npm run dev                # apps/api, npm run start:dev, hot-reload
npm run sim                # the scenario simulator, needs the app up
```

`apps/api/.env.example` documents every environment variable and *why* it
exists (signup bonus amount, step-up thresholds, the undo window, the
dispute window, the reputation threshold) — copy it to `apps/api/.env`
before the first run.

## Verifying it

The simulator (`sim/`) is the actual proof, not a demo script: it drives
real HTTP against the real API, and after **every** scenario — pass or
fail — it re-checks four invariants that must hold regardless of what the
scenario was testing: global conservation (`v_conservation` is always 0),
zero balance drift, zero negative non-system balances, and every
transaction's legs sum to zero. A scenario never re-checks these itself;
the harness does it for free, so a bug shows up on whichever scenario ran
next, not only the one written to look for it.

```bash
npm run sim                      # everything
npm run sim -- --tag disputes    # one group
npm run sim -- --reset           # clean slate first
```

Coverage as of this round: the full priority-feature set (transfers, HOLD/
undo, reversals, disputes, money requests, shared bills, reputation,
notifications) plus auth/validation edge cases and concurrency races, all
exercised over real HTTP with conservation held throughout. Exact
per-group pass counts move as agents land new scenarios — `TASKS_CLAUDE.md`
carries the current number; treat this README's own claim as directional,
not the source of truth.

## Multi-agent development note

This project was built collaboratively by a human developer plus four AI
coding agents working in parallel against the same repo: **Claude**
(backend + master coordination), **Codex** and **Antigravity** (backend
features, split by file ownership to avoid collisions), and **DeepSeek**
(UI design in Stitch + `UI_SPEC.md`). Coordination artifacts
(`TASKS_*.md`, `BUILD_LOG_*.md`) are kept in the repo root rather than
squashed away — they're the actual record of who built what, why, and
what was verified before being trusted, which is worth being able to
answer directly if asked.
