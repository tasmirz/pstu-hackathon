# Assignment: Antigravity — Round 3: Reputation Step-Up Enforcement

## Rounds 1 & 2 — done, verified, thank you

Round 1 (Disputes, Bill Payment 1:1, Shared Bill Payment) and Round 2
(HOLD/60-second undo-window transfers, incl. `sweeper.service.ts` and
extending `MoveMoneyParams` with account-id overrides) both landed and
pass their respective test scripts end to end
(`scripts/test-antigravity.js`, `scripts/test-antigravity-round2.js`),
verified live by Claude against the running app with conservation holding
throughout. Nothing in this round asks you to revisit either.

---

## The feature: Reputation

Claude built a read-only, derived trust score per user:
`ledger.v_user_reputation` (`infra/sql/005_reputation_claude.sql`, already
applied, granted to `txn_svc` — your pool can already select it, no new
migration needed). Score `0`–`100`, computed from completed transaction
count, account age, disputes the user was party to that resolved
`REVERSED`, and current `FROZEN` status. Full contract — including the
honest limitation about not being able to determine fault in a dispute —
is in `API.md` under **"Reputation"**. Read that section first.

Codex is separately exposing the score as a *read* (`GET /users/lookup`
gets a `reputation` field) — **not your job, don't touch `QueryModule`**.
Your job is the one new *enforcement* rule this feature adds to the money
path.

## What to build

**New step-up rule**: sending to a recipient whose `reputation_score < config.reputationStepUpThreshold`
(already added to `config.ts`, default `30`) requires step-up **regardless
of amount** — same mechanism as the existing first-time-recipient check,
just a different ledger fact and a different `reason` string.

In `TransfersService.transfer` (`modules/ledger/transfers/transfers.service.ts`),
alongside the existing first-time-recipient and amount-threshold
`requireStepUp` calls:

```ts
const repRes = await t.query(
  `SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`,
  [receiver.id],
);
const receiverScore = repRes.rows[0]?.reputation_score ?? 50; // no row yet = brand new user, neutral default
if (receiverScore < config.reputationStepUpThreshold) {
  requireStepUp({ userId: senderId, token: stepUpToken, reason: 'LOW_REPUTATION_RECIPIENT', always: true });
}
```

Run this check **inside the same transaction, before `moveMoney`** — same
placement as the first-time-recipient check, so it's evaluated against a
consistent read. Apply the identical pattern to **`BillsService.pay`** and
**`RequestsService.pay`** (checking the score of whoever is receiving the
money — the bill's `created_by` / the request's `requester_id`) — this
rule is general to "sending money to someone," not specific to plain
transfers, and those two paths already have their own `requireStepUp`
calls for the amount threshold that this slots in next to.

**Do not** add this check to `ReversalCoreService.applyReversal` or the
HOLD settle/cancel paths — those move money back to someone who already
had it, there's no new counterparty to vet.

## A judgment call worth making explicitly

A brand-new user has no rows in `ledger.v_user_reputation`'s underlying
aggregates yet (zero completed transactions, zero disputes) — the view's
`COALESCE`s mean they'd still get a real computed score (base 50 + a
sliver of tenure), not `NULL`, so the `?? 50` fallback above is a
belt-and-suspenders case that shouldn't normally trigger. If you find it
*does* trigger in testing, that's worth flagging — it would mean the view
isn't matching a user row for some reason, which is a real bug, not
expected behavior.

## Conventions — unchanged from Rounds 1 & 2

Same `requireStepUp` helper, same "idempotency claim first, CAS not
read-check-write, reuse `LedgerWriterPort`" shape. This round doesn't touch
`moveMoney` at all — it's purely an additional check before calling it.

## Ownership boundaries

**Yours**: `modules/ledger/transfers/transfers.service.ts`,
`modules/ledger/bills/bills.service.ts`,
`modules/ledger/requests/requests.service.ts` (all three already yours).
**Not yours**: `modules/query/**` (Codex, exposing the read side of the
same feature), `infra/sql/005_reputation_claude.sql` (already written and
applied by Claude).

## Verifying your work

Extend (or copy the shape of) your existing test scripts: seed a user,
manufacture a low score for them (easiest: raise and REVERSE a couple of
disputes against them via the existing `DisputesService`, or just seed one
directly with several `REVERSED` disputes involving them), then attempt a
transfer to them without a step-up token and assert `403
STEP_UP_REQUIRED` with `reason: 'LOW_REPUTATION_RECIPIENT'`; retry with a
valid step-up token and assert it succeeds. Check the three invariant
views after, same as every round:

```sql
SELECT * FROM ledger.v_conservation;      -- total_paisa must always be 0
SELECT * FROM ledger.v_balance_drift;     -- must always return 0 rows
SELECT * FROM ledger.v_negative_accounts; -- must always return 0 rows
```

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching, one-payer-many-payees split, load testing, the simulator. Don't
build these unless Claude asks.
