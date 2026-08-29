# Assignments: Antigravity

You're getting everything remaining on the backend this round — Rounds
5/6 below are done and verified; **7, 8, and 9 are new**, in priority
order. Work them in order; 9 is a stretch goal, not a requirement.

## Rounds 1–6 — done, verified, thank you

Disputes/Bill Payment/Shared Bill Payment (R1), HOLD/undo (R2), reputation
step-up enforcement (R3), full HTTP sim coverage for your own modules (R4),
`GET /money-requests/incoming`+`/outgoing` (R5), and notification writes off
`moveMoney` + `GET /notifications` (R6) are all live — confirmed via the
routes existing, clean build, and the full sim board DeepSeek ran to
**83/83, conservation held**. Codex's Round 4 (CONCURRENCY/HOLD/REVERSAL/
LIMITS) is also done — you're clear to touch `transfers.service.ts` and
`reversals.service.ts` again this round.

**Context that changes this round's priorities**: Codex found and audited
`D:\PSTUHACK\selected_extra_features.md` — a file outside this repo that
turns out to be the actual scoring rubric for 5 features (Bill Split, Group
Payment, Institute Bill Payment, Dispute Management, Reputation). Their
audit, `EXTRA_FEATURES_AUDIT_AND_DESIGN.md`, is excellent — **read it before
starting each round below**, it has the full data model, every edge case,
and a Mermaid diagram per case. This round's assignments below are scoped
straight from it; don't redesign what's already there, implement it.

---

## Round 7 (do first) — Dispute Management: escrow + recovery

This is the flagship example in the actual spec (`selected_extra_features.md`
§4) almost verbatim: A sends B ৳5,000, B legitimately spends ৳4,000 to C
*before* A disputes, A disputes, admin approves — refund A, don't touch
`B→C`, and B now owes a recoverable ৳4,000. The current `DisputesService`
correctly *fails* this case today (`402 INSUFFICIENT_FUNDS`, dispute stays
`OPEN` — see `DIS-07`/audit §5.2) rather than fabricating money, which was
the right thing to ship first. This round makes the case actually resolve.

Read audit §5 (`DM-01..09`) in full — it has the model
(`recovery_cases`, dispute-specific secured-amount tracking, the "secure
on open, not on resolve" ordering, DM-03's account-lock-sharing race) and
every edge case already worked out. Build:

1. **Secure on dispute open, not on resolve.** When a dispute is raised,
   lock the receiver's account (same lock the ledger writer already uses)
   and secure `min(receiver.available, disputed_amount)` — a new
   short-lived hold, not a ledger transaction yet. This is what makes
   DM-03 (B tries to spend while A disputes) resolve correctly: whichever
   operation gets the account lock first wins, same discipline as
   `moveMoney`'s existing ascending-id lock order.
2. **On admin REJECT**: release the secured amount back to B (a
   compensating no-money-moved unlock, not a ledger entry — nothing left
   this account, so nothing needs to move back).
3. **On admin APPROVE**: pay A the secured amount via `moveMoney`
   (`kind: 'DISPUTE_REFUND'` or similar — new kind, same pattern as
   `REVERSAL`). If the secured amount is less than the disputed amount,
   create a `recovery_cases` row for the deficit (debtor B, principal =
   deficit, outstanding = deficit) — **do not** invent a platform-reserve
   payout for the deficit this round (audit §5.3's "funded platform
   reserve" is real but out of scope; if there's no reserve, DM-02's
   correct behavior is: refund A only the secured amount, mark the dispute
   partially-refunded + `recovery_due` on B, and be honest about it in the
   response — don't pretend the full amount was refunded).
4. **`B→C` is never touched** — this is the one invariant to test hardest.
   Existing entries stay exactly as they are; the whole point is
   compensating records, not edits.
5. Skip the recovery *collection* workflow (DM-07 — future eligible
   inflows to B paying down `recovery_due`) this round; a `recovery_cases`
   row with an accurate `outstanding_amount` sitting there, visible on an
   admin endpoint, is the deliverable. Collection is a natural Round 8-ish
   follow-up once this lands.

New tables needed (your own migration,
`infra/sql/00N_dispute_recovery_antigravity.sql`) — model off audit §5.3:
a way to track a dispute's secured amount (could be columns on
`ledger.disputes` rather than a new table if that's simpler — your call,
just keep it CAS-friendly), plus `ledger.recovery_cases`
(debtor, dispute_id, principal, outstanding, state, timestamps). Grant
`txn_svc` read+write, `read_svc` read — same shape as every other
migration this project has. **Flag the exact grants in your build log** —
this is the one recurring bug class in this project (forgotten `GRANT
USAGE ON SCHEMA`), so a quick heads-up lets Claude sanity-check it in one
pass instead of it surfacing later as a mystery permission-denied error.

**Verify**: extend `sim/scenarios/dispute.ts` with `DIS-13`
(full DM-02 flow: B spends 80% away, dispute approved, A gets the secured
20%, `recovery_cases` shows 80 outstanding, `B→C` untouched) and `DIS-14`
(DM-03: concurrent spend-vs-dispute-open race, exactly one wins the
account lock, no double-use of funds). Conservation must hold throughout —
a recovery deficit is a receivable, not new money.

## Round 8 — Bill Split: equal split + safe partial payment

Audit §2 — the current implementation (custom fixed shares, one-shot full
payment per share) is solid but incomplete against the actual spec, which
explicitly asks for **equal split** and **partial payment within one
share**. Read `BS-01` through `BS-07` — the integer-remainder rule (BS-01)
and the overpayment/race guard (BS-03) are the two that matter most and
are already fully worked out with Mermaid diagrams.

1. **Equal split**: `POST /bills` gains a `split_mode: 'EQUAL'` option
   (alongside today's implicit `CUSTOM`) — caller supplies `total_amount`
   and a participant list (no per-participant amounts), server computes
   `floor(total / n)` for everyone plus deterministically distributes the
   `total % n` remainder paisa by participant order (BS-01). Store the
   computed amounts the same way custom shares are stored today — nothing
   downstream needs to know which mode created them.
2. **Partial payment within one share**: add `paid_amount` to
   `ledger.bill_shares` (or equivalent), change share `state` to include
   `PARTIALLY_PAID`, and let `POST /bills/:id/pay` accept an optional
   amount ≤ the share's remaining balance (default: pay it in full, same
   as today, for backward compatibility with existing scenarios). CAS
   condition: `paid_amount + payment <= assigned_amount`, same idempotency-
   claim-first discipline as everywhere else (BS-03).
3. Lock order fix (BS-05): make cancellation's lock order (bill-then-shares)
   consistent with payment's — audit your own existing `cancel()` and
   `pay()` for this before adding new code on top of an inconsistent base.

**Verify**: extend `sim/scenarios/bills.ts` with `BILL-06` (equal split,
3 participants, ৳100 → 34/33/33, sum exactly matches total), `BILL-07`
(two participants race to pay the last ৳500 of a share — exactly one
succeeds, same barrier-based concurrency pattern your existing `CON-*`
scenarios already use), `BILL-08` (partial payment: pay 60% of a share,
state is `PARTIALLY_PAID`, pay the remaining 40%, state flips to `PAID`
and the bill auto-settles if it was the last share).

## Round 9 (stretch — only if 7 and 8 are done and green)

**Send Money to a Group** — audit §3. This is the biggest of the three and
the audit's own recommended order puts it after Bill Split (its
reservation/escrow pattern reuses what Round 7 builds) and before
Institute Bill Payment (which reuses it again — Codex is doing that in
parallel, so there may be a shared-primitive opportunity to compare notes
on later, but don't block on it). Scope for a stretch attempt: the **all-
or-nothing initial reservation** (GP-03) and **per-recipient independent
child outcomes** (GP-01/GP-02) — that's the core of the feature and the
part every other GP-* case builds on. Skip the retry/backoff worker
machinery (GP-04's crash-recovery reconciliation, GP-06's cancel-races-
retry) if time runs out; a batch that reserves once and pays each child
independently, with an itemized result, is a legitimate partial delivery
of this feature even without background retry.

## Ownership boundaries

**Yours this round**: `disputes.service.ts`, `bills.service.ts`,
`bill-share` schema, and (if you get to Round 9) a new group-payment
module. **Codex is in `institute-bills/`** (new module, no file overlap).
`app.module.ts` — flag any new module for Claude to wire in.

## Explicitly out of scope

TOTP, the Kafka outbox relay actually consuming (notifications stay
synchronous per Round 6's design), the Centrifugo bridge, Redis caching,
load testing, chaos/Docker portability, and Reputation extensions (audit
§6 — its own recommended order puts this *last*, after typed dispute
outcomes exist from Round 7, so it's correctly not this round's job).
