# Assignment: Antigravity — Round 4: Sim Coverage for Your Own Modules (fast)

## Rounds 1–3 — done, verified, thank you

Disputes/Bill Payment/Shared Bill Payment (R1), HOLD/undo-window (R2), and
`LOW_REPUTATION_RECIPIENT` step-up enforcement (R3) all verified live —
R3's own `scripts/test-antigravity-round3.js` is 8/8 green, and Claude
independently reran it plus the full `sim` suite (LEDGER 7/7, HAPPY 6/6,
IDEMPOTENCY 6/6 — 19/19, conservation held) against the live server.
Nothing here asks you to revisit that logic.

---

## The gap this round closes

Every verification of Disputes/Requests/Bills so far — yours and Claude's —
has gone through the **service classes directly**
(`scripts/test-antigravity*.js` `require()`s `dist/modules/...` and calls
`.pay()`/`.resolve()` etc. straight on the class). That's real and it's
right for what it tested, but it means the **controller layer** — route
guards (`JwtAuthGuard`, `AdminGuard`), `X-Step-Up-Token` header parsing,
`Idempotency-Key` header handling, DTO validation — has never actually run
for your modules. `sim/`'s HAPPY and IDEMPOTENCY groups now prove exactly
that layer for Transfers (they hit real HTTP via `sim/harness/client.ts`).
Your modules are the one place that layer is still unproven.

This is fast because **all the plumbing already exists** —
`sim/harness/client.ts` already has every method you need:
`raiseDispute`, `myDisputes`, `adminDisputes`, `resolveDispute`,
`createRequest`/`payRequest`/`declineRequest`/`cancelRequest`/`remindRequest`,
`createBill`/`payBill`/`getBill`/`cancelBill`, `freeze`/`unfreeze`. You're
writing scenario bodies only, in the exact shape `sim/scenarios/happy.ts`
already demonstrates (read it first — `ctx.transfer`/`ctx.freshUsers`/
`ctx.expectEq` and the auto-step-up retry pattern all transfer directly).

## What to build

Two new files, same shape as `sim/scenarios/happy.ts` / `idempotency.ts`:

### `sim/scenarios/disputes.ts` — tag `disputes`
- **DIS-01**: raise a dispute on a completed transfer, admin resolves
  `REVERSE`, assert the reversal actually moved money back (balances) and
  `GET /disputes` shows `state: 'REVERSED'` — mirrors your own
  `test-antigravity.js` but over real HTTP with the JWT + AdminGuard path.
- **DIS-02**: admin resolves `REJECT` — no money moves, dispute closes
  `REJECTED`.
- **DIS-03**: `409 DISPUTE_ALREADY_OPEN` on a second raise while one is
  `OPEN`.
- **DIS-04**: `403 NOT_A_PARTY` when a third user tries to raise a dispute
  on someone else's transaction.
- **DIS-05** (bonus, only if time): after a `REVERSE`, spot-check both
  parties' `ledger.v_user_reputation` score dropped — ties this round back
  to Round 3's feature, and only needs one extra query via `ctx.adminPool`.

### `sim/scenarios/bills.ts` — tag `bills`
- **BILL-01**: create a 3-share bill, all three payers pay their own share
  (each via `ctx.client.payBill`, handling the first-time-recipient 403 →
  step-up → retry the same way `sim/scenarios/happy.ts` HAP-05 does — copy
  that pattern verbatim), assert the bill auto-`SETTLED` the instant the
  last share pays.
- **BILL-02**: `422 SELF_TRANSFER` when a share's phone is the creator's
  own.
- **BILL-03**: a payer can only pay their *own* share — attempt
  `payBill` as a non-participant, assert it's rejected (check the actual
  error your controller returns for this case first, don't guess the code).
- **BILL-04**: `cancelBill` before any share is paid succeeds; after at
  least one share is paid, assert it's rejected (check your own
  `bills.service.ts#cancel` for the exact CAS condition and error).

Every scenario gets the universal invariant check for free from
`runScenario` (`sim/harness/runner.ts`) — don't re-check
conservation/drift/negative yourself, same discipline as every existing
scenario file.

## Wiring in

Export `disputeScenarios: Scenario[]` and `billScenarios: Scenario[]` (same
naming convention as `happyScenarios`/`idempotencyScenarios`). Claude will
wire them into `sim/run.ts`'s `GROUPS` map once they land — you don't need
to touch `run.ts` yourself (avoids a merge on the one shared file), but do
run them locally first via a quick temporary import if you want to see
green before pushing.

## Ownership boundaries

**Yours (new)**: `sim/scenarios/disputes.ts`, `sim/scenarios/bills.ts`.
**Not yours**: `sim/run.ts` (Claude wires it in), `sim/harness/**`
(already has everything you need — if you find something genuinely
missing on the client, flag it in your build log rather than editing
`client.ts` yourself, since Claude/other agents may be mid-edit on it).

## Verifying your work

```bash
cd apps/api && npm run start:dev     # server must be up, same as always
npm run sim -w sim -- --tag disputes
npm run sim -w sim -- --tag bills
```
Both must be 100% green with `Conservation held across all N scenarios.`
in the summary line.

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching, one-payer-many-payees split, load testing. Don't build these
unless Claude asks.
