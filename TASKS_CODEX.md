# Assignment: Codex — Round 3: Sim Coverage for Your Own Modules (fast)

## Rounds 1 & 2 — done, verified, thank you

Bootstrap, `AuthModule`, `QueryModule`, `AdminModule` (R1) and the
`reputation` field on `GET /users/lookup` + `GET /admin/users/:id/reputation`
(R2) both landed and were verified live by Claude — build clean, all
routes mapped, `curl` against `/users/lookup` returns
`reputation: { score, tier }` matching `ledger.v_user_reputation` exactly.
Nothing here asks you to revisit that work.

---

## The gap this round closes

The `sim/` harness (Claude's track) now drives real HTTP against the app —
`sim/scenarios/happy.ts` and `idempotency.ts` are 12/12 green through the
actual controllers, guards, and step-up header parsing, for Transfers.
Antigravity is doing the same for Disputes/Requests/Bills this round (their
`TASKS_ANTIGRAVITY.md`). **Auth and Query — your modules — are the one
piece nobody has exercised through real HTTP edge cases yet.** Everyone's
been testing the happy path through them incidentally (every scenario
calls `register`/`login` to get going), but the actual *validation* and
*auth* behaviors — bad PIN, expired/reused refresh tokens, malformed
requests, lookup misses, non-admin hitting an admin route — have no
scenario coverage at all.

This is fast for the same reason Antigravity's round is: **all the client
plumbing already exists** in `sim/harness/client.ts` —
`register`/`login`/`refresh`/`logout`/`logoutAll`/`me`, `lookup`,
`integrity`, `freeze`/`unfreeze`. You're writing scenario bodies only, in
the shape `sim/scenarios/happy.ts` already demonstrates — read it first.

## What to build

One new file: `sim/scenarios/validation.ts` — tag `validation` (matches
`SIMULATOR.md`'s `VAL` group).

- **VAL-01**: `POST /auth/login` with a wrong PIN → assert the exact error
  shape your `AuthModule` returns (check the code, don't guess) — this is
  the one every wallet app gets subtly wrong (leaking whether the phone
  exists vs. the PIN being wrong).
- **VAL-02**: `POST /auth/refresh` with an already-used (rotated) refresh
  token → `TokenReuseDetected` — this is a real security property worth
  proving, not just documenting. If your refresh-rotation logic also
  revokes the whole session family on reuse detection, assert that too
  (a second legitimate refresh attempt with the *original* pre-rotation
  token should now also fail).
- **VAL-03**: `GET /users/lookup?phone=` for a phone that doesn't exist →
  `404 USER_NOT_FOUND`.
- **VAL-04**: `GET /admin/integrity` called by a non-admin token → `403`
  (this exact case was smoke-tested manually by Claude during R1 — turning
  it into a permanent scenario means it can't silently regress).
- **VAL-05**: register with a phone that's already taken → whatever your
  `AuthModule` actually returns (check first) — this is a validation path
  nobody has driven since your own manual testing during R1.
- **VAL-06** (bonus, only if time): `GET /users/lookup` reputation field —
  cross-check the score in the HTTP response against
  `SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`
  via `ctx.adminPool` for a freshly registered user, closing the loop on
  your own R2 work with an actual scenario instead of a one-off `curl`.

Every scenario gets the universal invariant check for free from
`runScenario` — don't re-check conservation/drift/negative yourself.

## Wiring in

Export `validationScenarios: Scenario[]` (same convention as
`happyScenarios`). Claude will wire it into `sim/run.ts`'s `GROUPS` map
once it lands — you don't need to touch `run.ts` (avoids a merge on the
one shared file).

## Ownership boundaries

**Yours (new)**: `sim/scenarios/validation.ts`. **Not yours**:
`sim/run.ts` (Claude wires it in), `sim/harness/**` (already has
everything you need — if something's genuinely missing on the client,
flag it in your build log rather than editing `client.ts` yourself).

## Verifying your work

```bash
cd apps/api && npm run start:dev     # server must be up, same as always
npm run sim -w sim -- --tag validation
```
Must be 100% green with `Conservation held across all N scenarios.` in the
summary line.

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching, one-payer-many-payees split, load testing. Don't build these
unless Claude asks.
