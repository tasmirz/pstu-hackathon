# Assignment: Antigravity — Round 5: `GET /money-requests/incoming` + `/outgoing`

## Rounds 1–4 — done, verified, thank you

Disputes/Bill Payment/Shared Bill Payment (R1), HOLD/undo (R2), reputation
step-up enforcement (R3), and full HTTP simulator coverage for your own
modules — `sim/scenarios/dispute.ts` (11/11), `bills.ts` (5/5), `requests.ts`
(5/5) (R4) — all verified live by Claude, `sim` is 68/81 clean on
non-chaos groups with the remaining failures already triaged to Codex
(concurrency/hold/reversal/limits scenario-vs-real-bug sweep, `TASKS_CODEX.md`
Round 4 — **not your file this round, avoid touching
`transfers.service.ts`/`reversals.service.ts` while they're mid-fix**).

Also: Claude noticed `sim/scenarios/disputes.ts` (your R4 delivery) and the
pre-existing `sim/scenarios/dispute.ts` both claimed ids `DIS-01..05` with
different bodies — merged the one thing `disputes.ts` had that `dispute.ts`
didn't (the reputation-drop check, now `DIS-12` in `dispute.ts`) and removed
`disputes.ts`. Nothing for you to do about it, just flagging so the history
makes sense if you go looking for that file.

---

## The gap this round closes

`API.md` documents two endpoints that were never actually built:

> **`GET /money-requests/incoming?state=`** · **`GET /money-requests/outgoing?state=`**
> Expired requests are returned with `state: "EXPIRED"` and are **not**
> silently omitted — a request that vanishes from the list reads as a bug.

`RequestsController` today only has `POST /`, `POST /:id/pay`, `/decline`,
`/cancel`, `/remind` — there is no way to *list* your money requests at all.
This isn't cosmetic: DeepSeek's already-designed **Money Requests
Inbox/Outbox** screens (`BUILD_LOG_DEEPSEEK.md`) have nothing to bind to
without it, and it's the one piece of the money-requests feature actually
missing against spec.

## What to build

Two new routes on `RequestsController` (`apps/api/src/modules/ledger/requests/`):

- **`GET /money-requests/incoming?state=&limit=&cursor=`** — requests where
  the caller is `payer_id` (money coming *to* them, i.e. they'd pay it).
- **`GET /money-requests/outgoing?state=&limit=&cursor=`** — requests where
  the caller is `requester_id` (money they're chasing).

Same keyset-pagination shape as `GET /transactions`
(`apps/api/src/modules/query/query.service.ts` — copy the `cursor`/`limit`/
`next_cursor`/`has_more` pattern, id-descending). `state=` is an optional
exact-match filter over `ledger.money_requests.state`
(`PENDING`/`PAID`/`DECLINED`/`EXPIRED`/`CANCELLED`).

**The lazy-expiry rule from `API.md` is the one part worth getting right**:
a `PENDING` row past `expires_at` must come back as `state: "EXPIRED"` in
the response — never omitted, and the DB row should actually flip to
`EXPIRED` (not just be presented that way), consistent with
`RequestsService.remind()`'s existing lazy-expiry check on read. Do this
with one `UPDATE ... WHERE state = 'PENDING' AND expires_at <= now() ...
RETURNING id` swept before the `SELECT` for the list (or a single
`UPDATE ... RETURNING *` folded into the query) — same "CAS, not
read-check-write" discipline as everywhere else, and it means a poller
hitting this endpoint repeatedly is what actually keeps expiry current,
no new cron/sweeper needed.

Response shape per item — mirror the create response's fields plus enough
to render a list row:
```jsonc
{ "id": 77, "state": "PENDING", "amount_paisa": 120000, "note": "for the ticket",
  "counterparty": { "id": 43, "name": "Karim U.", "phone": "+8801798765432" },
  "expires_at": "...", "reminded_at": null, "settled_txn_id": null, "created_at": "..." }
```
`counterparty` is the *other* party relative to which list it's in — the
payer's name/phone on `incoming` isn't useful (that's the caller), so it's
the requester's; symmetric on `outgoing`.

## Ownership boundaries

**Yours**: `apps/api/src/modules/ledger/requests/requests.controller.ts`,
`requests.service.ts` (both already yours). **Not yours right now**:
`transfers.service.ts`, `reversals.service.ts` — Codex is actively fixing
real bugs there this round (`TASKS_CODEX.md` R4); touching either risks a
conflict on files that are mid-edit.

## Verifying your work

Add scenarios to `sim/scenarios/requests.ts` (already yours from R4) —
**REQ-06**: create a request, `GET .../outgoing` shows it `PENDING` for the
requester and `GET .../incoming` shows it for the payer; **REQ-07**:
manufacture an expired one (`UPDATE ledger.money_requests SET expires_at =
now() - interval '1 day'` via `ctx.adminPool`, same trick
`RequestsService.remind()`'s own test already uses) and confirm it comes
back `state: "EXPIRED"` on both endpoints, not omitted, and the DB row
actually flipped. Add the two client methods to `sim/harness/client.ts`
(`incomingRequests`/`outgoingRequests`, same shape as `client.transactions`)
— that file's a shared resource but these are pure additions, not edits to
existing methods, so should merge cleanly.

```bash
cd apps/api && npm run start:dev
npm run sim -w sim -- --tag requests
```
Must stay 100% green, conservation held.

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching, one-payer-many-payees split, load testing, chaos/Docker
portability (Claude already fixed the compose-cwd bug in
`sim/harness/chaos.ts`; CHA-01 stays a known-flaky timing test, not yours
to chase). Don't build these unless Claude asks.
