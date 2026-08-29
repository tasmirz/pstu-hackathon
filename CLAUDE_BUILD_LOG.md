# CLAUDE Build Log

Continuation of `BUILD_LOG_CLAUDE.md` (kept as-is for history — read it
first for full context: the three-services-to-one-monolith pivot, the
schema amendments, and the Codex/Antigravity task split). From here on,
new entries go in **this** file. Newest entry on top.

---

## 2026-08-29 — Simulator: starting the harness (not assigned to Codex or Antigravity)

Per the user: keep working, but only on what isn't already someone else's
task. Codex owns bootstrap/Auth/Query/Admin; Antigravity owns
Disputes/Bills/Requests (done) and is now on HOLD/undo-window (Round 2).
Nobody owns the **scenario simulator** (`SIMULATOR.md`) — it was flagged
"not started" in every status update so far, it was the very first thing
the user asked to be built alongside features back at the start of this
session, and its own spec explicitly says the invariant checks need no API
and should be built *first*, in parallel with the ledger, not bolted on at
the end. That makes it the correct next task: real, high-value, and
genuinely unclaimed.

Starting with exactly what `SIMULATOR.md` §2 and §6 prescribe as the first
slice: `sim/harness/invariants.ts` (pure SQL, no API dependency at all —
works today regardless of whether Codex's bootstrap has landed),
`sim/harness/report.ts`, `sim/harness/seed.ts`, and `sim/run.ts`, then the
`LEDGER` scenario group (`LED-01..07`, Tier 1, runs standalone). `client.ts`
(the typed HTTP client against `API.md` shapes) and every scenario group
that needs a live server (`HAP`, `IDEM`, `VAL`, `CON`, ...) waits until
Codex's bootstrap is confirmed up, since there's no endpoint to call yet —
but the invariant harness and the board/report plumbing can be fully built
and proven correct right now against the live database.

**Built and green**: `sim/` is now a workspace package (`npm run sim -w sim`).

- `config.ts` — two DB connections on purpose: `adminUrl` (direct :5432) for
  reads/seeding, `txnSvcUrl` (:6432 via PgBouncer, the real `txn_svc` role)
  used only to prove the append-only permission boundary with the actual
  least-privilege role, not a superuser standing in for it.
- `harness/invariants.ts` — `checkStructuralInvariants` (conservation/drift/
  negative/every-txn-balances, all four in one round trip via the existing
  views + one grouped query), `checkAppendOnly` (UPDATE/DELETE as `txn_svc`,
  asserting the *specific* Postgres permission-denied error rather than just
  "it threw"), `checkUnbalancedLegRejected` (hand-inserts one unbalanced
  entry, asserts COMMIT itself fails with the trigger's message, then rolls
  back — `entries.txn_id`/`account_id` carry no FK per SCHEMA.sql, so a
  negative fake id needs nothing to pre-exist).
- `harness/seed.ts` — `freshUser(s)`, direct-SQL (not HTTP) account creation
  that mirrors `POST /auth/register`'s exact commit shape (user row + `USER`
  account + a real `SIGNUP_BONUS` transaction+entries+balance updates) — so
  seeded accounts are indistinguishable from ones made through the real
  endpoint, and the LEDGER group runs today without waiting on Codex's Auth.
- `harness/types.ts` + `harness/runner.ts` — the `Scenario` shape and the
  wrapper SIMULATOR.md §1 describes: snapshot -> run -> scenario assertions
  -> universal invariant re-check, always, for free. A scenario file never
  re-checks conservation itself.
- `harness/report.ts` — terminal board grouped by scenario group, failures
  printed with the assertion message plus the invariant snapshot before/after
  so a break points at the scenario that caused it; `--json` writes
  `sim/sim-results.json` (gitignored).
- `scenarios/ledger.ts` — `LED-01..07`, all seven green:
  ```
  LEDGER                    7/7  PASS
  Conservation held across all 7 scenarios.
  ```
  Verified `LED-05`/`LED-06` actually connect as `txn_svc` and get real
  Postgres `permission denied` errors (not a mocked check), and `LED-07`
  actually gets the trigger's exact exception text at COMMIT. Also
  spot-checked `harness/seed.ts` directly (seeded two users, confirmed the
  ৳100,000 signup-bonus balance, re-ran the LEDGER group — still 7/7).

Next: once Codex's bootstrap + AuthModule are confirmed running,
`harness/client.ts` (typed HTTP client per `API.md`) and the `HAP`/`IDEM`/
`VAL`/`CON` scenario groups.
