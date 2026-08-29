# Assignment: Codex — Round 4: Simulator Reliability Sweep

> **STATUS: complete and verified.** Concurrency 7/7, HOLD 5/5,
> Reversal 4/4, and Limits 3/3 pass together (19/19); conservation held
> after every scenario. The failures were scenario setup/contract drift, not
> backend state-transition bugs. API build and simulator type-check are clean.

## Previous rounds — complete

Bootstrap/Auth/Query/Admin, reputation reads, and Auth/Query validation
coverage are merged and verified. `sim/scenarios/validation.ts` now combines
DeepSeek's transfer validation (`VAL-01..08`) with Codex's Auth/Query/Admin
coverage (`VAL-09..14`): **14/14 green, conservation held**.

## Goal

Turn the remaining non-chaos simulator groups green against a clean, current
API build. Treat the simulator as a bug finder: determine whether each failure
is a stale scenario assumption or a real application race/state bug before
changing code.

### 1. Reproduce cleanly

- Start the current API on a dedicated port and point `SIM_API_BASE_URL` at it.
- Run with `--reset` where isolation matters.
- Run groups separately: `concurrency`, `hold`, `reversal`, and `limits`.
- Record exact failing scenario IDs before editing.

### 2. Fix scenario-contract drift

Known stale assumptions seen before the latest merge include:

- first-time/low-reputation recipient checks requiring step-up before the
  scenario reaches the state it intends to test;
- held transfers returning `202` rather than immediate `201`;
- controller success codes changing between `200` and `201`.

Obtain a step-up token explicitly when a test is about a later rule. Accept
multiple statuses only when the API contract genuinely permits both; do not
weaken assertions just to make the board green.

### 3. Diagnose real races

Pay special attention to concurrent settle-vs-cancel and pay-vs-decline. If
both mutually exclusive outcomes commit, fix the application with a CAS/state
transition guard and add a precise regression assertion. Preserve double-entry
and idempotency guarantees.

### 4. Verification

- `npx tsc --noEmit -p sim/tsconfig.json`
- API build clean.
- Each assigned group 100% green.
- Final combined non-chaos run reports conservation, zero drift, and zero
  negative accounts.

## Ownership

You may edit the affected simulator scenarios and the smallest backend service
needed for a proven bug. Do not redesign Disputes/Bills/Requests behavior that
already matches `API.md`; Antigravity's completed work is the baseline.

## Out of scope

Chaos/Docker portability is a separate follow-up. TOTP, Kafka consumers,
Centrifugo, Redis caching, load testing, and new product features remain out of
scope.
