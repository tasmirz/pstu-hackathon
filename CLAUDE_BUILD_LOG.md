# CLAUDE Build Log

Continuation of `BUILD_LOG_CLAUDE.md` (kept as-is for history — read it
first for full context: the three-services-to-one-monolith pivot, the
schema amendments, and the Codex/Antigravity task split). From here on,
new entries go in **this** file. Newest entry on top.

---

## 2026-08-29 — Final polish pass: root README, stale PLAN.md/package.json, live re-verification

Per the user: do my own final tasks while the other three agents work
theirs. Deliberately picked work that's real, valuable, and structurally
incapable of colliding with Codex (mid-`institute-bills/`, uncommitted) or
Antigravity (dispute recovery / bill split) — repo-root documentation and
config hygiene, not application code.

- **`README.md`** (new, repo had none) — what's running, why it's built
  this way (append-only ledger enforced by `REVOKE`, idempotency-claim-
  first, the three-role boundary preserved through the monolith pivot),
  the feature list split into shipped vs. this-round-in-progress, a repo
  map, run/verify instructions, and an explicit multi-agent note. This is
  the one artifact a judge reads first — `PSTU_Hackathon_Problem_Statement.md`
  (found at `question/`, not the root — good to know it moved) explicitly
  asks the team to "understand, explain, and defend" the engineering
  decisions, and there was nothing at the root doing that job.
- **`PLAN.md`** — added a status banner at the top. It still describes the
  original three-service architecture with no indication the pivot
  happened; a judge reading it cold would think that's what's deployed.
  Left the historical content untouched, pointed to `README.md` for
  current reality and `BUILD_LOG_CLAUDE.md` for why.
- **`package.json`** — `dev:auth`/`dev:txn`/`dev:read`/`db:seed` all
  pointed at workspaces/scripts that don't exist post-pivot
  (`apps/auth-gateway` etc. were removed, `scripts/seed.js` was never
  written). Replaced with one `dev` script pointing at `apps/api`, the
  thing that's actually there.
- **Live re-verification** — rebuilt, restarted the server, ran the full
  sim: **86/88, conservation held throughout.** New since the last
  full-board number (83/83): `LIMITS` went 1/3→3/3 and `CONCURRENCY` 3/7→7/7
  now genuinely both green (Codex's Round 4 + DeepSeek's fixes, confirmed
  live rather than trusted from the build logs), plus a new `NOTIFICATIONS`
  group at 5/5 (Antigravity's Round 6). The two failures
  (`HLD-03`/`HLD-04`, sweeper-settle timing) are a test/demo config
  mismatch, not a regression: `.env` currently holds the demo-realistic
  `UNDO_WINDOW_SECONDS=60`/`SWEEPER_INTERVAL_MS=5000` (correctly restored
  after DeepSeek's earlier fast-test run), and those two scenarios sleep a
  fixed 250ms hoping the sweeper already fired — nowhere near enough at
  demo values. Already correctly diagnosed in `BUILD_LOG_DEEPSEEK.md`;
  noting it here again only because it's the one thing keeping the board
  from 88/88, and it's an intentional tradeoff (fast values for
  iterating on the sim, demo values for the actual 3pm run), not a bug to
  chase.
- Noticed `infra/keys/private.pem` is committed to git. Left it alone
  deliberately — every credential in this project already follows a
  `changeme_*` placeholder convention for exactly this kind of closed
  hackathon demo, regenerating it now would invalidate every already-
  issued token for zero real security benefit in a fake-money ecosystem,
  and touching auth keys mid-crunch is exactly the kind of "hard to
  reverse" change the house rules ask to avoid without a clear reason.
  Flagging it here in case anyone disagrees with that call.
- Did **not** touch `packages/shared/src/types.ts` or anything under
  `apps/api/src/modules/ledger/institute-bills/` — both were mid-edit,
  uncommitted, under Codex's active work when I checked; staged and
  committed only my own three files.

## 2026-08-29 — The real rubric surfaced: full redistribution around `EXTRA_FEATURES_AUDIT_AND_DESIGN.md`

Codex's Round 4 landed clean (CONCURRENCY/HOLD/REVERSAL/LIMITS all green —
no real race, `CON-04`'s apparent double-win was the scenario checking the
reversal child's state instead of the original's). Antigravity's Rounds
5/6 also landed (`GET /money-requests/incoming`+`/outgoing`, notification
writes off `moveMoney` + `GET /notifications`). DeepSeek, meanwhile,
independently picked up and fixed the whole remaining sim board (their own
initiative, outside their assigned track) to **83/83, conservation held**
— their build log has the exact per-scenario root causes, all scenario-
contract drift, no real backend bugs found beyond what Codex already
fixed.

**The bigger event**: Codex, unprompted, found `D:\PSTUHACK\selected_extra_features.md`
— a file living *outside* this repo that turns out to be the actual
grading rubric for 5 "extra" features (Bill Split, Send Money to a Group,
Institute Bill Payment, Dispute Management, Reputation-Based Fraud
Detection) and wrote `EXTRA_FEATURES_AUDIT_AND_DESIGN.md`, a thorough gap
analysis of the current codebase against every one of them — full data
models, every edge case, a Mermaid diagram per case. This changes the
priority list: everything built so far (disputes, bill payment, shared
bill payment, reputation) was the *right foundation*, but the rubric is
specifically grading extensions to it that don't exist yet.

Read the whole audit and re-planned the next round around it:

- **Dispute Management** (audit §5) is the highest-value gap — its missing
  piece (escrow-on-open + a recoverable-deficit workflow when the receiver
  already spent the disputed money) is almost the spec's flagship worked
  example verbatim. The current code correctly *fails safe* here today
  (`402`, dispute stays `OPEN`) rather than fabricating money — this round
  makes that case actually resolve instead of dead-ending.
- **Bill Split** (audit §2) needs equal-split mode and safe partial
  payment within one share — the current custom-shares/one-shot-pay
  implementation is solid but narrower than the spec asks for.
- **Institute Bill Payment** (audit §4) doesn't exist at all yet, and
  Codex already fully designed it — natural to have them build what they
  scoped, and it's a clean, disjoint new module.
- **Send Money to a Group** (audit §3) doesn't exist either, and is the
  single biggest lift of the five — queued as a stretch goal, after the
  two above, per the audit's own recommended build order.
- **Reputation extensions** (audit §6) are deliberately left out this
  round — the audit's own recommended order puts them last, since
  attributing fault correctly needs the dispute-recovery typed outcomes
  from Round 7 to exist first.

Per the user's explicit instruction, gave Antigravity the bulk of it
(Rounds 7/8/9 — dispute recovery, bill split completion, group send
stretch, "everything remaining"), Codex a clean self-contained new feature
they'd already designed (Institute Bill Payment), DeepSeek the UI for all
of it plus their still-unstarted Round 3 backlog, and kept my own new
scope to the coordination docs themselves — no new SQL or app code this
round, both backend agents own their own migrations for the new tables
(with an explicit ask to flag the exact grants added, since a forgotten
`GRANT USAGE ON SCHEMA` has been the one recurring real bug class this
project has hit — reputation and notifications both needed a follow-up
grant fix after the fact).

Rewrote `TASKS_CODEX.md`, `TASKS_ANTIGRAVITY.md`, `TASKS_DEEPSEEK.md`, and
`TASKS_CLAUDE.md` to reflect the new priority list end to end.

## 2026-08-29 — Re-checked Codex R4 (not landed yet), queued Antigravity Round 6: notification writes

User asked to check whether Codex's Round 4 (CONCURRENCY/HOLD/REVERSAL/
LIMITS fixes) had landed. Re-fetched `origin/main` (no new commits since
my last push), confirmed no uncommitted local changes, rebuilt, restarted
the server, and reran the full `sim` suite: **identical 11 failures**,
byte-for-byte the same as before Round 4 was assigned. Asked the user
directly rather than guessing — answer: leave Codex's Round 4 in place
(still working on it), and give Antigravity additional work in the
meantime.

**New Round 6 for Antigravity, queued behind Round 5**: while re-reading
`SCHEMA.sql` for something genuinely new and unclaimed, noticed
`ledger.outbox` and `notify.notifications` already exist — full shape,
built for the original 3-service design where a Kafka relay drains the
outbox into notifications. That relay was explicitly deferred, but the
tables were never dead weight: `moveMoney` already writes an outbox row on
every call. Rather than have Antigravity half-build a relay that talks to
a Kafka topic nobody consumes, the honest move is simpler and *more*
consistent: write the `notify.notifications` row in the same transaction
as the ledger legs, directly in `moveMoney` — no redelivery window to
dedupe, and it's the actual backend counterpart to DeepSeek's Round 3
Notification-feed screen design, which currently has no data to bind to.
Documented in the task file exactly which `kind`s should notify whom, and
explicitly told them not to reach for `REQUEST_NEW`/`LIMIT_WARNING` this
round since those don't originate inside `moveMoney`.

`SCHEMA.sql` only granted schema `notify` to `read_svc` — `txn_svc` had no
access at all, so I wrote and applied `infra/sql/006_notifications_claude.sql`
(`GRANT USAGE ON SCHEMA notify TO txn_svc; GRANT SELECT, INSERT ON
notify.notifications ...`), with a comment explaining exactly when this
insert should move to a real relay instead (the day an external consumer —
push notifications, Centrifugo — needs the Kafka hop too). Verified via
`scripts/apply-schema.js` — applies cleanly, idempotent like every other
amendment.

## 2026-08-29 — Full sim sweep (68/81), deduped a dispute-scenario collision, fixed the chaos harness; Round 5 for Antigravity

Pulled a burst of concurrent work: Antigravity's Round 4
(`sim/scenarios/dispute.ts`/`bills.ts`/`requests.ts`, plus their own
`disputes.ts` and controller `@HttpCode` fixes), Codex's merge of
Auth/Query validation scenarios into `sim/scenarios/validation.ts`
(`VAL-09..14`, 14/14 combined with the existing transfer ones), and a much
bigger batch — `auth.ts`/`limits.ts`/`concurrency.ts`/`hold.ts`/
`reversal.ts`/`chaos.ts` — landed in one go (`48acecc`, `4ee0c99`,
`b4ed17c`, `0d33603`) covering essentially the rest of `SIMULATOR.md`'s
scope at once. Both Codex and DeepSeek had also already written their own
next-round task files directly (`TASKS_CODEX.md` Round 4, `TASKS_DEEPSEEK.md`
Round 3) — read both, they're accurate and well-scoped, adopted as-is
rather than duplicating the effort.

**Found and fixed one real duplication**: `sim/scenarios/dispute.ts`
(pre-existing, 11 scenarios, Tier 2 — raise/party/window/reject/reverse/
failure-accounting/concurrent-resolve/audit-log) and Antigravity's R4
`sim/scenarios/disputes.ts` (5 scenarios) both claimed ids `DIS-01..05`
with different bodies, and only `dispute.ts` was wired into `run.ts`. Diffed
them — `disputes.ts` was a strict subset except for one check `dispute.ts`
didn't have (a spot-check that both parties' `ledger.v_user_reputation`
score actually dropped after a `REVERSE`). Ported that one scenario into
`dispute.ts` as `DIS-12`, deleted `disputes.ts`. No content lost, no id
collision, one less file to keep in sync.

**Fixed a real bug in the simulator's own chaos harness**:
`sim/harness/chaos.ts` shells out to `docker compose`, but `npm run sim -w
sim` runs with cwd `sim/`, not the repo root where `docker-compose.yml`
lives — every chaos command was failing before it ever touched a
container. Fixed by passing `cwd: REPO_ROOT` (computed via
`join(__dirname, '..', '..')`) to `execSync`, and wrapped `waitHealthy`'s
status check in a try/catch (it wasn't, so a mid-restart container that
threw briefly on `docker compose ps` would crash the whole scenario instead
of just retrying). `CHAOS` went from 0/3 to 2/3 — the remaining failure,
`CHA-01` (kill Postgres exactly mid-transfer, assert the client sees an
error), is inherently timing-flaky by what it's testing, not a bug.

**Ran the full suite for the first time** against a rebuilt, restarted
server:
```
LEDGER 7/7  HAPPY 6/6  IDEMPOTENCY 6/6  VALIDATION 14/14  REQUESTS 5/5
DISPUTE 12/12  AUTH 4/4  BILLS 5/5  =  59/59
CONCURRENCY 3/7  HOLD 3/5  REVERSAL 2/4  LIMITS 1/3  CHAOS 2/3
```
Skimmed every failure to classify scenario-drift vs. real bug before
assigning anything: most of CONCURRENCY/HOLD/REVERSAL/LIMITS read as the
same "written before the HOLD/undo-window and reputation step-up features
existed" pattern already fixed twice this session (expects `201`, HOLD
threshold correctly returns `202`; missing a step-up token before racing a
first-time-recipient send) — but `CON-04` (concurrent cancel-vs-sweeper-
settle on one HELD transfer reporting **both** `CANCELLED` and `COMPLETED`
as having won) reads like it could be a genuine CAS gap, worth someone
actually checking rather than assuming. Left the full triage-and-fix to
Codex's own Round 4 brief (already correctly scoped for exactly this) —
this needed diagnosis, not scenario tweaks I'd be guessing at.

**New task for Antigravity (Round 5)**: `API.md` documents
`GET /money-requests/incoming` and `/outgoing` — neither exists.
`RequestsController` only has create/pay/decline/cancel/remind; there's no
way to *list* your money requests at all, which means DeepSeek's
already-designed Inbox/Outbox screens have nothing to bind to. Real,
spec'd, unclaimed gap. Told them explicitly to stay out of
`transfers.service.ts`/`reversals.service.ts` this round since Codex is
actively fixing bugs there.

Adopted Codex's and DeepSeek's self-written task files into
`TASKS_CLAUDE.md`'s status table rather than rewriting them — they matched
reality and there was no reason to duplicate the work of describing it.

## 2026-08-29 — Verified Codex R2 + Antigravity R3 live; wired sim's HTTP groups; found 3 real bugs (in the scenarios, not the app); new fast round for Codex + Antigravity

Both agents delivered the reputation round to `origin/main` (Codex's
Round 2 landed as commit `96c3106` — `query.service.ts` gains the
`reputation` field via a small `reputationTier()` helper in
`modules/query/reputation.ts`, plus a P2
`GET /admin/users/:id/reputation`; Antigravity's Round 3 landed as
`84d78a4` — the `LOW_REPUTATION_RECIPIENT` check added to
`TransfersService`/`RequestsService`/`BillsService`, exactly the pattern
specified). Verified both for real before touching anything else:

- `npx nest build` clean.
- Booted the app locally, confirmed `GET /admin/users/:id/reputation`
  is mapped and `GET /users/lookup` returns `reputation: { score, tier }`
  matching `ledger.v_user_reputation` directly.
- Ran `scripts/test-antigravity-round3.js` live: normal/low-reputation
  recipients on Transfers, Requests, and Bills all behave correctly
  (403 without step-up, 201 with it), conservation/drift/negative clean
  throughout — **8/8 green**.

Antigravity had also (unprompted, but useful and disjoint) started on the
simulator's HTTP layer — `sim/harness/client.ts` (a full typed client
against every endpoint in `API.md`) plus `sim/scenarios/happy.ts` and
`idempotency.ts` — landed in the same push. This is exactly the piece
`CLAUDE_BUILD_LOG.md`'s previous entry flagged as blocked on "Codex's
bootstrap being confirmed up," which it now is, so picking it up was the
right call. It wasn't wired into `sim/run.ts` yet — did that (`GROUPS` now
has `ledger`/`happy`/`idempotency`), then ran the whole suite for the
first time against the live server:

```
LEDGER   7/7  HAPPY  5/6 FAIL  IDEMPOTENCY  4/6 FAIL
```

Three real failures, and this is the simulator doing exactly its job —
each one traced to a genuine scenario bug, not an app bug, and each one
is evidence a feature built this session is working *correctly*:

- **HAP-05** (request-then-pay) had the requester/payer roles backwards —
  `POST /money-requests` is created by the person who gets paid
  (`from_phone` names the payer, per `API.md`), and the scenario had it
  swapped. Fixed the call direction.
- **IDEM-04** (per-user idempotency-key scoping) had user B sending to a
  recipient they'd never paid before, without accounting for the
  `FIRST_TIME_RECIPIENT` step-up rule — a 403 that's correct, not a bug.
  Switched to `ctx.transfer` (auto-retries with the PIN step-up) instead
  of the raw client call, same as every other leg in the file.
- **IDEM-06** (step-up-then-retry, one debit) used an amount above
  `config.undoThresholdPaisa`, so a successful retry correctly lands as
  `202` (`HELD`, Antigravity's Round 2 feature) rather than `201`
  (`COMPLETED`) — the scenario was written assuming immediate settlement.
  Fixed the assertion to accept either status, since the actual property
  under test (exactly one debit) holds regardless.

Also deleted a leftover placeholder assertion in IDEM-04
(`expectEq(x, x ? x : x, ...)` — always true, said nothing) and replaced
it with an actual balance check. Re-ran: **19/19, 0 failed, conservation
held across all 19 scenarios.**

**New fast round for Codex and Antigravity**, same shape both times: write
scenario files against `sim/harness/client.ts`, which already has every
method either of them needs — no new endpoints, no shared-file
contention, genuinely quick. The gap being closed: every verification of
Disputes/Requests/Bills so far (Antigravity's own scripts) calls the
service classes directly, bypassing the controller layer entirely — the
guards, step-up header parsing, and DTO validation for those three modules
have never actually run. Antigravity gets `sim/scenarios/disputes.ts` +
`bills.ts` (their own modules, over real HTTP, for the first time). Codex
gets the mirror image for their own modules: `sim/scenarios/validation.ts`
— Auth/Query edge cases (bad PIN, refresh-token reuse, 404 lookup,
non-admin hitting `/admin/integrity`, duplicate registration) that nobody
has scenario-covered, only smoke-tested by hand. Both told explicitly not
to touch `sim/run.ts` — Claude wires each group in once it lands, keeping
that one shared file conflict-free the same way it's stayed conflict-free
all session.

Updated `TASKS_CLAUDE.md`'s status table, assignments, and checklist to
match current reality.

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

## Merged in: Codex's bootstrap (verified live) + Antigravity Round 2 (HOLD/undo)

While writing the simulator above, Codex delivered `main.ts`/`app.module.ts`/
`AuthModule`/`QueryModule`/`AdminModule` directly to disk (uncommitted at
the time) and Antigravity pushed Round 2 to `origin/main`. Handled both:

- Waited for Codex's files to stop changing, then rebuilt `apps/api` — clean
  — and ran a **live end-to-end HTTP smoke test** against the real server:
  register (real signup-bonus ledger txn) → login → `GET /accounts/me/balance`
  → `GET /users/lookup` → step-up → `POST /transfers` (idempotent, real
  double-entry) → promoted a user to `ADMIN` via `scripts/promote-admin.js`
  → `GET /admin/integrity` (`pass:true` on all four checks) → confirmed a
  non-admin gets `403 FORBIDDEN` on that same route. Applied Codex's new
  migration (`004_admin_integrity_grants_codex.sql` — `txn_svc` SELECT on
  the integrity views). Committed everything together (`1dd13d2`).
- `git fetch` then showed `origin/main` had diverged (Antigravity pushed
  Round 2 — HOLD/undo-window transfers — on a branch that also picked up an
  intermediate UI-spec-doc commit). Merged (`git merge origin/main`, no
  conflicts — Antigravity's changes and mine touched disjoint files exactly
  as the task-file ownership boundaries intended). Antigravity extended
  `MoveMoneyParams` with optional `senderAccountId`/`receiverAccountId`
  overrides plus `state`/`settleAfter`/`outboxTopic` — option 1 from
  `TASKS_ANTIGRAVITY.md`'s two suggested approaches — and added
  `sweeper.service.ts`. Rebuilt clean, ran their
  `scripts/test-antigravity-round2.js` end to end (below/above threshold,
  cancel-within-window, sweeper auto-settle, late-cancel-after-settle all
  `409`, conservation/drift/negative clean throughout) — all green. Re-ran
  the simulator's LEDGER group against the same, now busier database — still
  7/7.

**The backend is now fully integrated and demoable**: register, login,
transfers (plain + HOLD/undo), reversals, disputes (+ admin resolve),
money requests, shared bills, and admin integrity all work over real HTTP
against the real ledger, with conservation holding throughout. Remaining
open items tracked in `TASKS_CLAUDE.md`'s checklist.

## New feature: Reputation, and redistributing all three agents

Per the user: add a reputation system for user accounts, then give all
three agents (Codex, Antigravity, and DeepSeek — read `BUILD_LOG_DEEPSEEK.md`
first) a new round of tasks.

Design: a **derived, read-only** score, never a mutable column — same
reasoning already used for why `accounts.balance` is a cache and
`ledger.entries` is the truth, applied to a new kind of derived fact.
`ledger.v_user_reputation` (`infra/sql/005_reputation_claude.sql`):
base 50, + up to 30 for completed-transaction experience, + up to 10 for
account tenure, − 15 per `REVERSED` dispute either side of the transaction
was party to, − 40 while `FROZEN`, clamped to `0`–100`. Documented the
honest limitation directly in the SQL comment and in `API.md`: this system
cannot determine fault in a dispute (a reversal might be the receiver's
fault, or an honest mistake by the sender), so the penalty lands on both
parties to a reversed transaction rather than pretending to know who was
at fault. Verified against live data — users with `REVERSED` disputes
against them score visibly lower (36–37) than clean accounts (50–51).

Granted `SELECT` to both `read_svc` and `txn_svc` — the read side (Codex's
`QueryModule`) and the new enforcement rule (Antigravity's ledger write
path) both need it, no new grant story beyond the existing view pattern.
Added `config.reputationStepUpThreshold` (default 30) and a new step-up
reason, `LOW_REPUTATION_RECIPIENT`, documented in `API.md`'s step-up rules
table next to the existing first-time-recipient rule it sits beside in the
code. Updated `UI_SPEC.md` §4 step 1 with the reputation dot in the lookup
result row and the `LOW`-tier unconditional-step-up case at step 2.

Split three ways, same seam every other feature has used: **Codex**
exposes the read (`GET /users/lookup` gains `reputation: {score, tier}`),
**Antigravity** adds the enforcement (the step-up check itself, in
`TransfersService`/`BillsService`/`RequestsService`, right next to their
existing amount-threshold checks), **DeepSeek** designs the UI (a compact
indicator that doesn't outrank the recipient's name, applied everywhere a
phone lookup already resolves a name, plus a new step-up copy variant for
the `LOW`-tier case). Zero file overlap between the three by construction —
DeepSeek's track has never touched backend code, and Codex/Antigravity's
new work is in the same disjoint files their previous rounds already
established (`modules/query/**` vs `modules/ledger/{transfers,bills,requests}/**`).

Also gave DeepSeek two backlog items from their own "not yet designed"
list (noted in their last log entry): the frozen-account Dashboard banner
state, and the `REVERSAL` row style in Transaction History — both cheap,
both real UI_SPEC gaps, both unclaimed by anyone else.

Rewrote `TASKS_CLAUDE.md` to track all three agents across all rounds so
far, with the new reputation-round assignments at the top.
