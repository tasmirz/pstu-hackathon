# Assignments: Antigravity

## Round 5 — `GET /money-requests/incoming` + `/outgoing` (in progress / next up)

If you haven't started this yet, do it first — it's still the more urgent
gap (DeepSeek's Inbox/Outbox screens have nothing to bind to without it).
Full brief below, unchanged. If it's already done and pushed, skip straight
to **Round 6**.

## Rounds 1–4 — done, verified, thank you

Disputes/Bill Payment/Shared Bill Payment (R1), HOLD/undo (R2), reputation
step-up enforcement (R3), and full HTTP simulator coverage for your own
modules — `sim/scenarios/dispute.ts` (11/11), `bills.ts` (5/5), `requests.ts`
(5/5) (R4) — all verified live by Claude. Full non-chaos `sim` run is
70/81; the remaining 11 (CONCURRENCY/HOLD/REVERSAL/LIMITS + one chaos
timing test) are Codex's Round 4, actively in progress — **stay out of
`transfers.service.ts` and `reversals.service.ts` until that lands**, same
as last round.

Also: Claude noticed `sim/scenarios/disputes.ts` (your R4 delivery) and the
pre-existing `sim/scenarios/dispute.ts` both claimed ids `DIS-01..05` with
different bodies — merged the one thing `disputes.ts` had that `dispute.ts`
didn't (the reputation-drop check, now `DIS-12`) and removed `disputes.ts`.
Nothing for you to do about it.

---

## Round 5 (full brief)

`API.md` documents two endpoints that were never actually built:

> **`GET /money-requests/incoming?state=`** · **`GET /money-requests/outgoing?state=`**
> Expired requests are returned with `state: "EXPIRED"` and are **not**
> silently omitted — a request that vanishes from the list reads as a bug.

`RequestsController` today only has `POST /`, `POST /:id/pay`, `/decline`,
`/cancel`, `/remind` — there is no way to *list* your money requests at
all. Build:

- **`GET /money-requests/incoming?state=&limit=&cursor=`** — requests where
  the caller is `payer_id`.
- **`GET /money-requests/outgoing?state=&limit=&cursor=`** — requests where
  the caller is `requester_id`.

Same keyset-pagination shape as `GET /transactions`
(`apps/api/src/modules/query/query.service.ts`). `state=` is an optional
exact-match filter over `ledger.money_requests.state`.

**Lazy-expiry**: a `PENDING` row past `expires_at` must come back as
`state: "EXPIRED"` — never omitted — and the DB row should actually flip
(one `UPDATE ... WHERE state = 'PENDING' AND expires_at <= now() ...`
swept before the list query), same as `RequestsService.remind()`'s
existing lazy-expiry check.

```jsonc
{ "id": 77, "state": "PENDING", "amount_paisa": 120000, "note": "for the ticket",
  "counterparty": { "id": 43, "name": "Karim U.", "phone": "+8801798765432" },
  "expires_at": "...", "reminded_at": null, "settled_txn_id": null, "created_at": "..." }
```
`counterparty` is the *other* party — the requester's identity on
`incoming`, the payer's on `outgoing`.

**Verify**: add `REQ-06`/`REQ-07` to `sim/scenarios/requests.ts` (create →
both endpoints show it; manufacture an expired one via `ctx.adminPool` →
both endpoints show `EXPIRED`, not omitted). Add
`incomingRequests`/`outgoingRequests` to `sim/harness/client.ts` (pure
additions, shouldn't conflict).

---

## Round 6 — Notification writes (start once Round 5 is pushed)

### The feature

`SCHEMA.sql` already has the full shape for this from the original
3-service design — `ledger.outbox` (every `moveMoney` call already writes
a row there) and `notify.notifications` — meant for a Kafka relay that
drains the outbox into notifications. That relay isn't running (explicitly
deferred, `TASKS_CLAUDE.md`). Rather than half-build a relay that talks to
nothing, **write the notification row directly, in the same transaction as
the ledger legs** — `moveMoney` is the one place every money movement
already funnels through. This is honestly *more* consistent than the
eventual relay (no redelivery window to dedupe), and it's the real
backend counterpart to DeepSeek's Round 3 Notification-feed screen design —
right now that screen has no data to bind to.

Claude already granted the missing permission
(`infra/sql/006_notifications_claude.sql` — `txn_svc` can now write
`notify.notifications`; applied, no migration needed from you) and left a
comment there explaining exactly when this insert should move to a relay
instead (the day an external consumer — push notifications, Centrifugo —
needs the Kafka hop too).

### What to build

**1. In `LedgerWriterService.moveMoney`** (`apps/api/src/modules/ledger/core/ledger-writer.service.ts`),
right after the existing `ledger.outbox` insert, insert one or two rows
into `notify.notifications` depending on `kind`:

| `kind` | Notify | `kind` column | Title/body shape |
|---|---|---|---|
| `TRANSFER` | both parties | sender: `TXN_SENT`, receiver: `TXN_RECEIVED` | "Sent ৳X to {name}" / "Received ৳X from {name}" |
| `HOLD_SETTLE` (sweeper) | receiver only | `TXN_RECEIVED` | same as above — the sender already got their `HELD` notice at send time |
| `HOLD_CANCEL` | sender only | — (skip; it's their own undo, not news) | — |
| `REQUEST_SETTLE` | requester only | `REQUEST_PAID` | "{payer name} paid your request for ৳X" |
| `BILL_SHARE_SETTLE` | bill creator only | `REQUEST_PAID` (reuse — same shape, no need for a new kind) | "{payer name} paid their ৳X share of {bill title}" — title isn't available inside `moveMoney`; pass it through `note` the way `Cancel of {ref}` already does, or read the bill row if `parentTxnId`/context is already in scope where `BillsService.pay` calls `moveMoney` |
| `REVERSAL` | both parties | `REVERSAL` | "Reversed: {original description}" — the row `sim/scenarios/happy.ts`... actually `dispute.ts` already asserts exists on the read side; this is its notification counterpart |
| `SIGNUP_BONUS` | skip | — | registration already shows the balance immediately, a notification adds nothing |

Don't invent new `notify.notifications.kind` values beyond the ones
`SCHEMA.sql`'s comment already lists
(`TXN_RECEIVED | TXN_SENT | REQUEST_NEW | REQUEST_PAID | REVERSAL |
LIMIT_WARNING`) — `REQUEST_NEW` (a request being *created*, not paid) and
`LIMIT_WARNING` (approaching the daily cap) both belong outside
`moveMoney` (request creation moves no money; a limit warning isn't a
transfer at all) — leave those two as a clearly-flagged follow-up in your
build log rather than reaching for them here, since this round is
specifically "hang notifications off the one function every money
movement already goes through."

**2. `GET /notifications?unread=&limit=&cursor=`** and
**`POST /notifications/:id/read`** (or `/read-all`) — a small
`NotificationsModule` in the query/read domain (`read_svc` already has
full read/write on `notify.notifications` from `SCHEMA.sql`, no new grant
needed). Same keyset pagination as everywhere else. This is a new module,
so it needs one line in `app.module.ts` — flag it in your build log rather
than editing that file yourself; Claude will wire it in (same rule as
every module addition since Round 1).

### Verify

New `sim/scenarios/notifications.ts` — tag `notifications`: a transfer
generates the sender's `TXN_SENT` and receiver's `TXN_RECEIVED`, a paid
request generates the requester's `REQUEST_PAID`, marking one read flips
`read_at` and it drops out of `?unread=true`. Universal invariants stay
free from `runScenario` as always — this feature touches no balances.

```bash
cd apps/api && npm run start:dev
npm run sim -w sim -- --tag notifications
```

## Ownership boundaries

**Yours**: `ledger-writer.service.ts` (small, additive change — the
existing outbox insert and everything above it stays untouched), a new
`NotificationsModule` under `modules/notifications/` or similar,
`sim/scenarios/notifications.ts`. **Not yours right now**:
`transfers.service.ts`/`reversals.service.ts` (Codex, R4 in progress),
`app.module.ts` (flag the new module for Claude to wire in).

## Explicitly out of scope

TOTP, the Kafka outbox relay actually consuming `ledger.outbox` (this
round's whole point is not needing it yet), the Centrifugo bridge, Redis
caching, one-payer-many-payees split, load testing, chaos/Docker
portability. Don't build these unless Claude asks.
