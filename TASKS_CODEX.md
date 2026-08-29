# Assignment: Codex — Institute Bill Payment

## Round 4 — done, verified, thank you

CONCURRENCY/HOLD/REVERSAL/LIMITS all green (folded into the 83/83 full
board — DeepSeek's build log has the exact per-scenario fixes; no real
race was found, `CON-04`'s apparent double-win was a query bug in the
*scenario*, checking the reversal child's state instead of the original's).

**And thank you for `EXTRA_FEATURES_AUDIT_AND_DESIGN.md`** — that wasn't
assigned, and it's exactly the right next move: `D:\PSTUHACK\selected_extra_features.md`
is the actual scoring rubric (outside this repo, so nobody else had reason
to look for it), and your gap analysis against it is thorough and accurate.
Claude read it in full and is using it as the basis for this round's
assignments across all three agents.

---

## The task: Institute Bill Payment (§4 of your own audit)

You already designed this end to end — `institutes` / `institute_bills` /
`institute_payment_attempts`, the accept-before-deadline rule, IB-01..08.
Build it. This is the one selected feature with zero implementation yet
and a genuinely novel rule (server-time deadline admission, not amount or
party logic like everything else in the ledger so far) — a clean, separate
module, no collision risk with Antigravity's dispute/bill-split work this
round.

**The one rule that matters most**: `accepted_at <= deadline`, both values
read from the same database transaction, decided and **funds reserved**
before that transaction commits. Everything else (settlement succeeding or
failing afterward) is downstream of that one atomic decision — get IB-01
(accepted just before deadline, settles after) and IB-02 (rejected just
after) genuinely right and the rest of your own design falls out of it.

### Scope for this round

- Schema: your own §4.3 model. New tables only — no changes to
  `ledger.transactions`/`entries`. Follow the existing grant pattern
  (`infra/sql/00N_<feature>_<you>.sql` — copy the shape of
  `002_bills_and_role_claude.sql`'s role grants for the new tables,
  `txn_svc` for the write path, `read_svc` for listing). Flag the exact
  grants you added in your build log so Claude can sanity-check the
  schema/role boundary in one pass rather than needing to re-derive it —
  this is the one place a missed `GRANT USAGE ON SCHEMA` has bitten this
  project twice already (reputation, notifications).
- Endpoints: create an institute bill (admin/seed-only for now — no
  institute-onboarding flow needed this round), student `POST
  .../pay` (idempotent, reserves + settles in one transaction if the
  institute-settlement step is synchronous for now — no need to build a
  real async institute-settlement worker yet, IB-05's retry/callback
  design can stay a documented follow-up), `GET` for a student's own
  bills/attempts.
- Money movement: reuse `LedgerWriterPort.moveMoney` for the actual
  transfer to the institute's settlement account — don't hand-roll a
  second double-entry path. `kind: 'INSTITUTE_BILL_SETTLE'` (new kind,
  same pattern as `BILL_SHARE_SETTLE`/`REQUEST_SETTLE`).
- Deadline test coverage matters more than breadth here: `sim/scenarios/institute.ts`
  covering your own IB-01/IB-02/IB-03 (before/at/after deadline, using
  `ctx.adminPool` to manufacture a bill with a deadline in the past/future/
  now — same trick `dispute.ts`'s window-closed test already uses) plus
  IB-04 (idempotent retry after the cutoff returns the original accepted
  attempt, doesn't re-evaluate as late).

### What to leave for later (your own audit already flags these — don't build them now)

Multi-currency, institute onboarding/verification, real async
institute-settlement callbacks with retry backoff (IB-05), time-zone
display formatting (IB-07), and true partial/installment institute bills
(IB-08's second half) — store the plumbing so these aren't precluded
(`TIMESTAMPTZ` everywhere, a `state` column with room to grow), but don't
build the workflows.

## Ownership boundaries

**Yours**: a new `apps/api/src/modules/ledger/institute-bills/` (or similar)
module, its own migration file. **Not yours**: `transfers.service.ts`,
`bills.service.ts` (Bill Split completion), `disputes.service.ts` (dispute
escrow/recovery) — both are Antigravity's this round
(`TASKS_ANTIGRAVITY.md`). `app.module.ts` — flag the new module for Claude
to wire in, same rule as every module addition since Round 1.

## Verifying your work

```bash
cd apps/api && npm run start:dev
npm run sim -w sim -- --tag institute
```
100% green, conservation held, plus your own IB-01..04 assertions actually
checking `accepted_at` against `deadline` at the database level (not just
HTTP status codes).

## Explicitly out of scope

Everything already listed as out of scope project-wide (TOTP, real Kafka
consumers, Centrifugo, Redis caching, load testing), plus — this round
specifically — Group Payment and Reputation extensions (both Antigravity's
or deferred; see `TASKS_CLAUDE.md`).
