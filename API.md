# API Contract

**This file exists so D is never blocked on B.** It is written at Phase 0 and is the single source of truth for request/response shapes. If the backend deviates, the backend updates this file in the same commit.

Base URL: `http://localhost:3000` — one NestJS app (`apps/api`), layered
controller → service → repository, with the auth/ledger/read concerns kept
as separate modules and DB roles internally (see `BUILD_LOG_CLAUDE.md`
"Pivot"). Every shape below is unchanged by that; it only affects how the
backend is deployed, not the contract.

---

## Conventions

### Money is always `*_paisa`, always an integer

Every monetary field on the wire carries `_paisa` in its name and is a JSON integer. `৳2,500.00` is `250000`.

The unit is in the field name deliberately: the single most common demo-day bug in a money app is one screen rendering ৳25.00 where another renders ৳2,500, and a field literally named `amount_paisa` cannot be misread by a tired developer at 14:00. There are no floats anywhere in this API.

### Auth

All endpoints except `/auth/register`, `/auth/login`, `/auth/refresh` and `/admin/*` require:
```
Authorization: Bearer <access_token>
```
Access tokens are RS256, 15-minute lifetime. Only the Auth Gateway holds the private key; every other service verifies with the public key alone.

### Idempotency

Every **mutating money endpoint** requires:
```
Idempotency-Key: <uuid v4>
```
- The client generates it **before the request fires** and stores it.
- A retry after a timeout **reuses the same key**. Generating a new key on retry is how a network blip becomes a double debit.
- Same key + same body → the original response is replayed verbatim, `200`.
- Same key + **different** body → `422 IDEMPOTENCY_KEY_REUSE`. Never silently replayed.

### Step-up authentication

Endpoints marked **step-up** require an additional header when the rule triggers:
```
X-Step-Up-Token: <short-lived token from POST /auth/step-up>
```
Rules and where they are evaluated:

| Rule | Evaluated at | Why |
|---|---|---|
| Amount > ৳20,000 | Auth Gateway | The gateway can read `amount_paisa` from the body |
| First-ever recipient | **Txn Service** | This is a ledger fact the gateway does not hold |
| Any reversal | Auth Gateway | Endpoint-level rule, no ledger lookup needed |
| Limit override (admin) | Auth Gateway | Endpoint-level rule |

When step-up is required and absent, the endpoint returns `403 STEP_UP_REQUIRED` with `{"reason": "FIRST_TIME_RECIPIENT"}`. The client then calls `POST /auth/step-up` and retries **with the same `Idempotency-Key`**.

### Errors

```jsonc
{
  "error": "INSUFFICIENT_FUNDS",         // stable machine code, safe to switch on
  "message": "Balance is ৳500.00, need ৳2,500.00",
  "details": { "balance_paisa": 50000, "required_paisa": 250000 }
}
```

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed body |
| 401 | `UNAUTHENTICATED` | Missing/expired access token |
| 401 | `TOKEN_REUSE_DETECTED` | Refresh family revoked — force re-login |
| 402 | `INSUFFICIENT_FUNDS` | Sender balance too low |
| 403 | `STEP_UP_REQUIRED` | TOTP/PIN re-entry needed |
| 403 | `ACCOUNT_FROZEN` | Sender frozen (receiving still works) |
| 403 | `DAILY_LIMIT_EXCEEDED` | Would exceed the daily send cap |
| 404 | `USER_NOT_FOUND` / `TXN_NOT_FOUND` | — |
| 409 | `INVALID_STATE` | CAS failed — already settled/cancelled/reversed |
| 409 | `DISPUTE_ALREADY_OPEN` | A dispute is already open on that transaction |
| 403 | `NOT_A_PARTY` | Only the sender or receiver may dispute a transaction |
| 422 | `DISPUTE_WINDOW_CLOSED` | Transaction is older than the 7-day dispute window |
| 422 | `IDEMPOTENCY_KEY_REUSE` | Same key, different payload |
| 422 | `SELF_TRANSFER` | Sender == receiver |
| 423 | `ACCOUNT_LOCKED` | Too many failed PIN attempts |
| 429 | `VELOCITY_EXCEEDED` | >10 txn/min — requires PIN re-entry |

### Pagination

Keyset only. Never `OFFSET`.
```
GET /transactions?limit=20&cursor=1043
→ { "items": [...], "next_cursor": 1021, "has_more": true }
```
`next_cursor` is `null` when exhausted. `cursor` is the last `id` seen.

---

# Auth Gateway — `/auth/*`

### `POST /auth/register`
```jsonc
// →
{ "phone": "+8801712345678", "name": "Rahim Ahmed", "pin": "1234" }
// ← 201
{
  "user": { "id": 42, "phone": "+8801712345678", "name": "Rahim Ahmed", "status": "ACTIVE" },
  "access_token": "eyJ...", "refresh_token": "rt_...",
  "signup_bonus_paisa": 10000000,
  "balance_paisa": 10000000
}
```
The ৳100,000 bonus is minted from `SYSTEM_MINT` as a **real double-entry transaction** (`kind: SIGNUP_BONUS`) in the same commit as the account creation. Nothing in this system bypasses the ledger, including the money the system gives away.

### `POST /auth/login`
```jsonc
// → { "phone": "+8801712345678", "pin": "1234" }
// ← 200 { "access_token": "...", "refresh_token": "...", "user": {...} }
// ← 401 { "error": "UNAUTHENTICATED", "details": { "attempts_remaining": 3 } }
// ← 423 { "error": "ACCOUNT_LOCKED", "details": { "locked_until": "2026-08-29T10:35:00Z" } }
```
No TOTP at login. TOTP is a step-up mechanism for dangerous actions, not a login tax.

### `POST /auth/refresh`
```jsonc
// → { "refresh_token": "rt_..." }
// ← 200 { "access_token": "...", "refresh_token": "..." }   // rotated
// ← 401 { "error": "TOKEN_REUSE_DETECTED" }
```
Presenting an already-consumed refresh token means the token was stolen and replayed. The **entire token family is revoked** — both the thief and the legitimate user are logged out, which is the correct outcome. Demoable in 30 seconds: refresh twice with the same token.

### `POST /auth/logout` · `POST /auth/logout-all`
`logout` revokes the current family. `logout-all` bumps `token_version`, invalidating every outstanding access token immediately.

### `POST /auth/pin/change`  **step-up**
```jsonc
// → { "current_pin": "1234", "new_pin": "5678" }
// ← 200 { "sessions_revoked": 3 }
```

### `POST /auth/totp/enroll`
```jsonc
// ← 200
{ "secret": "JBSWY3DPEHPK3PXP",
  "otpauth_url": "otpauth://totp/PSTUPay:+8801712345678?secret=...&issuer=PSTUPay",
  "backup_codes": ["4821-9930", "..."] }   // shown ONCE, stored hashed
```

### `POST /auth/totp/verify`
Completes enrolment. `{ "code": "123456" }` → `200 { "enrolled": true }`.

A TOTP code is valid for a 30-second window; without replay protection the same code works twice inside its own window. Each `(user, time_step)` is consumed exactly once — a replayed code returns `401`.

### `POST /auth/step-up`
```jsonc
// → { "method": "TOTP", "code": "123456" }        // or { "method":"PIN", "pin":"1234" }
// ← 200 { "step_up_token": "su_...", "expires_in": 120 }
```

### `GET /auth/me`
`→ 200 { "id": 42, "phone": "...", "name": "...", "status": "ACTIVE", "totp_enrolled": true }`

### `GET /auth/ws-token`
```jsonc
// ← 200 { "token": "eyJ...", "channel": "user#42", "url": "ws://localhost:8000/connection/websocket" }
```
Centrifugo connection token, scoped to this user's channel only. The `#` form is Centrifugo's user-limited channel: user 42 cannot subscribe to `user#43`. **Verify the exact channel syntax against the Centrifugo docs before wiring** — it is the one piece of third-party config in the stack.

---

# Txn Service — writes

Every endpoint here is **synchronous**: it returns only after the money is committed and durable. Nothing on this list is queued.

### `POST /transfers`  **idempotent, step-up**
```jsonc
// → Idempotency-Key: 550e8400-...
{ "to_phone": "+8801798765432", "amount_paisa": 250000, "note": "lunch" }

// ← 201
{
  "transaction": {
    "id": 1043, "ref": "TXN_01J8...", "kind": "TRANSFER", "state": "COMPLETED",
    "amount_paisa": 250000, "note": "lunch",
    "counterparty": { "id": 43, "name": "Karim Uddin", "phone": "+8801798765432" },
    "created_at": "2026-08-29T11:02:14Z"
  },
  "balance_paisa": 9750000,
  "entries": [
    { "account_id": 84, "amount_paisa": -250000 },
    { "account_id": 86, "amount_paisa":  250000 }
  ]
}
```
`balance_paisa` is returned so the client never needs a follow-up read to show the new balance — this is how read-your-own-writes is guaranteed even if a replica is added later.

**If the amount exceeds the undo threshold (৳5,000)** the response is `202` with `state: "HELD"` and a `settle_after` timestamp. The money has already left the sender into their HOLD account — it cannot be double-spent — but it does not reach the receiver until the window closes.

```jsonc
// ← 202
{ "transaction": { "id": 1044, "state": "HELD", "settle_after": "2026-08-29T11:03:14Z", ... },
  "balance_paisa": 8750000,
  "can_cancel_until": "2026-08-29T11:03:14Z" }
```

### `POST /transfers/:id/cancel`  **idempotent**
Cancels a `HELD` transfer inside its undo window. Creates a `HOLD_CANCEL` transaction moving the money from HOLD back to the sender, and CASes the original `HELD → CANCELLED`.
```
← 200 { "transaction": {...}, "balance_paisa": 9750000 }
← 409 INVALID_STATE   // window closed, sweeper already settled it
```

### `POST /splits`  **idempotent, step-up**
One debit, N credits, one atomic transaction. Multi-entry double-entry makes this nearly free — the same `assert_balanced` trigger covers 2 legs or 20.
```jsonc
// → { "recipients": [ {"phone":"+880...","amount_paisa":50000}, ... ], "note": "dinner" }
// ← 201 { "transaction": { "kind": "SPLIT", ... }, "balance_paisa": ..., "entries": [ 1 debit + N credits ] }
```

### `POST /transactions/:id/reverse`  **idempotent, step-up**
Never deletes, never updates. Creates a **new** transaction with `kind: REVERSAL` and mirrored entries, linked by `reverses_txn_id`. The original row is untouched forever.
```
← 201 { "reversal": {...}, "original": {...} }
← 409 INVALID_STATE       // already reversed — enforced by a unique index, not an if
← 402 INSUFFICIENT_FUNDS  // receiver already spent it
```
That `402` is the honest-failure case worth volunteering to a judge: we do not fabricate money to undo a transfer. If the receiver spent it, the reversal fails and becomes a dispute.

### `POST /transactions/:id/refund`  **idempotent**
Receiver-initiated return of a received transfer. Same compensating-entry mechanism, initiated from the other side.

### `POST /money-requests`
```jsonc
// → { "from_phone": "+8801798765432", "amount_paisa": 120000, "note": "for the ticket" }
// ← 201 { "id": 77, "state": "PENDING", "expires_at": "2026-08-30T11:02:14Z", ... }
```
Creating a request moves **no money** and requires no step-up. A request is a message, not a debit.

### `POST /money-requests/:id/pay`  **idempotent, step-up**
The payer approves. Runs the ordinary transfer path with `kind: REQUEST_SETTLE`, and CASes the request `PENDING → PAID` in the same transaction. Returns the same shape as `POST /transfers`.

### `POST /money-requests/:id/decline` · `/cancel` · `/remind`
`decline` (payer) → `DECLINED`. `cancel` (requester) → `CANCELLED`. `remind` (requester) is rate-limited to once per hour and only queues a notification. All three are CAS-guarded off `PENDING`; a request that expired between page-load and tap returns `409 INVALID_STATE`.

### `POST /disputes`
```jsonc
// → { "txn_id": 1043, "reason": "Sent to the wrong number" }
// ← 201 { "id": 12, "txn_id": 1043, "state": "OPEN", "created_at": "..." }
// ← 409 DISPUTE_ALREADY_OPEN     // partial unique index, not an if-statement
// ← 403 NOT_A_PARTY              // only sender or receiver may dispute
// ← 422 DISPUTE_WINDOW_CLOSED    // transaction older than 7 days
```
Either party to the transaction may raise a dispute. One **open** dispute per transaction, enforced by a partial unique index — a closed dispute may later be superseded by a new one.

Raising a dispute moves **no money** and does not freeze the transaction. It creates a work item for an admin.

### `GET /disputes` — the raiser's own view
`{ "items": [ { "id": 12, "txn_id": 1043, "state": "OPEN", "reason": "...", "resolution": null } ], ... }`

---

# Bill Payment

Two distinct features, both settling money straight out of the payer's
**normal `USER` ledger account** — no escrow, no separate wallet. A bill is a
business-process record around a sequence of ordinary transfers; the money
itself is exactly as real and exactly as double-entry as everywhere else.

**Bill Payment (1:1)** — one person owes one fixed amount to another. This
*is* `POST /money-requests` + `POST /money-requests/:id/pay` above, wearing
"Bill Payment" as the product name for it. No new endpoint.

**Multi-user Shared Bill Payment** — one bill, several payers, each owing
their own share; the bill settles once every share is paid. New tables
(`ledger.bills`, `ledger.bill_shares` — `infra/sql/002_bills_and_role_claude.sql`),
new endpoints below.

### `POST /bills`
```jsonc
// → {
//   "title": "Dinner at Kacchi Bhai",
//   "shares": [
//     { "phone": "+8801798765432", "amount_paisa": 40000 },
//     { "phone": "+8801765432109", "amount_paisa": 40000 }
//   ]
// }
// ← 201
{
  "id": 5, "ref": "BILL_01J9...", "title": "Dinner at Kacchi Bhai",
  "total_amount_paisa": 80000, "state": "OPEN",
  "shares": [
    { "id": 11, "payer": { "id": 43, "name": "Karim U.", "phone": "+8801798765432" },
      "amount_paisa": 40000, "state": "PENDING" },
    { "id": 12, "payer": { "id": 44, "name": "Nadia S.", "phone": "+8801765432109" },
      "amount_paisa": 40000, "state": "PENDING" }
  ],
  "created_at": "2026-08-29T13:00:00Z"
}
```
`total_amount_paisa` is the **sum of the shares**, not a separately-entered
number — there is nothing for the client to keep in sync. Creating a bill
moves **no money** and needs no step-up, same reasoning as a money request:
it's a message, not a debit. A share whose phone resolves to the creator is
rejected `422 SELF_TRANSFER` — you cannot owe your own bill.
```
← 400 VALIDATION_ERROR    // fewer than 2 shares, a non-positive amount, duplicate phone
← 404 USER_NOT_FOUND      // a share's phone doesn't resolve
← 422 SELF_TRANSFER       // a share's phone is the creator's own
```

### `GET /bills/mine?role=created|owed&state=&limit=&cursor=`
`role=created` — bills you created. `role=owed` — bills where you have a
share (paid or not). Same keyset pagination shape as `GET /transactions`.

### `GET /bills/:id`
Full detail, every share with its current state — the same "show all the
legs" philosophy as transaction detail (API.md §Read Service).
```jsonc
{ "id": 5, "ref": "BILL_01J9...", "title": "...", "total_amount_paisa": 80000,
  "state": "OPEN", "created_by": { "id": 42, "name": "Rahim A." },
  "shares": [
    { "id": 11, "payer": { "id": 43, "name": "Karim U." }, "amount_paisa": 40000,
      "state": "PAID", "settled_txn_id": 1102 },
    { "id": 12, "payer": { "id": 44, "name": "Nadia S." }, "amount_paisa": 40000,
      "state": "PENDING", "settled_txn_id": null }
  ], "created_at": "..." }
```

### `POST /bills/:id/pay`  **idempotent, step-up**
Pays the **caller's own share** — there is no share id in the URL; a payer
can only ever settle their own debt. Runs the same double-entry path as a
transfer (`kind: BILL_SHARE_SETTLE`, payer's normal account → creator's
normal account), CASes that share `PENDING → PAID`, and — inside the same
transaction — CASes the bill `OPEN → SETTLED` the moment every share on it
is `PAID`.
```jsonc
// ← 200
{ "transaction": { "id": 1102, "kind": "BILL_SHARE_SETTLE", "state": "COMPLETED",
                   "amount_paisa": 40000, "created_at": "..." },
  "balance_paisa": 9600000,
  "bill": { "id": 5, "state": "OPEN" } }        // "SETTLED" once this was the last share

← 402 INSUFFICIENT_FUNDS
← 403 STEP_UP_REQUIRED     // same >৳20,000 / first-time-recipient rules as a transfer
← 404 BILL_SHARE_NOT_FOUND // you have no share on this bill
← 409 INVALID_STATE        // your share is already PAID, or the bill is CANCELLED
```

### `POST /bills/:id/cancel`   *(P2 — build only if ahead)*
Creator-only. Cancels every still-`PENDING` share (`CANCELLED`) and the bill
itself. **Never touches an already-`PAID` share** — that money moved for
real and is undone with a reversal/dispute, not a bill cancellation.

---

# Read Service — queries

Serves reads and owns the `notify` schema. It holds **SELECT-only grants on `ledger`** — it is structurally incapable of writing to the ledger, which is what makes the service boundary a fact rather than a convention.

### `GET /accounts/me/balance`
```jsonc
// ← 200
{ "balance_paisa": 9750000, "held_paisa": 1000000, "available_paisa": 8750000 }
```
Reads the **primary**, not a replica — read-your-own-writes. `held_paisa` is the sum of the user's HOLD account and is shown as a separate line whenever it is non-zero.

### `GET /accounts/me/limits`
```jsonc
{ "daily_limit_paisa": 5000000, "spent_today_paisa": 250000,
  "remaining_paisa": 4750000, "resets_at": "2026-08-30T00:00:00+06:00" }
```

### `GET /transactions?limit=&cursor=&direction=&kind=`
`direction` ∈ `sent | received | all`. `kind` filters (e.g. `REVERSAL`). Stale-tolerant — this is the query that routes to a replica the moment one exists.
```jsonc
{ "items": [ { "id": 1043, "ref": "TXN_01J8...", "kind": "TRANSFER", "state": "COMPLETED",
               "direction": "sent", "amount_paisa": 250000, "note": "lunch",
               "counterparty": { "name": "Karim Uddin", "phone": "+8801798765432" },
               "reverses_txn_id": null, "created_at": "..." } ],
  "next_cursor": 1021, "has_more": true }
```

### `GET /transactions/:id`
Full detail **including both ledger legs** — this is what makes double-entry visible to a judge without opening the code.
```jsonc
{ "id": 1043, "ref": "TXN_01J8...", ...,
  "entries": [ { "account_id": 84, "account_type": "USER", "amount_paisa": -250000 },
               { "account_id": 86, "account_type": "USER", "amount_paisa":  250000 } ],
  "reversal": { "id": 1099, "created_at": "..." },
  "can_reverse": true }
```

### `GET /money-requests/incoming?state=` · `GET /money-requests/outgoing?state=`
Expired requests are returned with `state: "EXPIRED"` and are **not** silently omitted — a request that vanishes from the list reads as a bug.

### `GET /users/lookup?phone=`
```jsonc
// ← 200 { "id": 43, "name": "Karim U.", "phone": "+8801798765432", "is_first_time": true }
// ← 404 { "error": "USER_NOT_FOUND" }
```
Returns **first name + last initial**, not the full name. This resolves a real tension in the feature list: full names would leak the phonebook to anyone enumerating numbers, but full masking (`Ka*** U***`) would defeat the recipient-confirmation screen, which only works if a human can recognise the wrong person. First-name-plus-initial is enough to catch a typo and not enough to harvest.

`is_first_time` drives the first-time-recipient warning chip and tells the client to expect a step-up challenge.

### `GET /notifications?limit=&cursor=` · `POST /notifications/:id/read`
Written by the Kafka consumer inside this service, deduplicated on `event_id` — Kafka is at-least-once, so every event arrives at least twice on some crash path and without the dedupe table the user sees each notification twice.

---

# Admin — `/admin/*`

Separate `ADMIN` role claim. Every mutating admin action writes to `ledger.audit_log` with actor, before/after JSONB, and a **mandatory** reason.

### `GET /admin/integrity`  ← **the screen that wins the demo**
```jsonc
{
  "conservation":  { "pass": true, "total_paisa": 0 },
  "balance_drift": { "pass": true, "accounts_checked": 200, "drifted": [] },
  "negative":      { "pass": true, "accounts": [] },
  "chain":         { "pass": true, "verified_to_entry_id": 40188 },
  "checked_at": "2026-08-29T13:14:02Z"
}
```
On failure, each block returns the **actual numbers and offending account ids** — never a bare `false`. If this fails live in front of a judge, showing exactly what broke is a far better recovery than a generic red X.

### `GET /admin/health`
```jsonc
{ "db": { "ok": true, "latency_ms": 1.2 },
  "pgbouncer": { "ok": true, "cl_active": 34, "sv_active": 8, "pool_size": 50 },
  "kafka": { "ok": true, "consumer_lag": 0 },
  "redis": { "ok": true, "hit_rate": 0.82, "keys": 1204 },
  "outbox": { "unprocessed": 0, "dead_letter": 0, "oldest_unprocessed_age_s": null } }
```

### `GET /admin/metrics`
`{ "tps": 1840, "p95_latency_ms": 24, "active_locks": 12, "connections": 34 }` — live numbers for the load test. Numbers beat claims.

### `POST /admin/load-test`
```jsonc
// → { "accounts": 200, "transfers": 5000, "concurrency": 200 }
// ← 200
{ "duration_ms": 2717, "tps": 1840, "p95_latency_ms": 24,
  "supply_before_paisa": 2000000000, "supply_after_paisa": 2000000000,
  "supply_unchanged": true, "negative_balances": 0, "failed": 0, "deadlocks": 0 }
```
5,000 concurrent transfers in a ring, asserting total supply unchanged and no negative balance. This is the demo that wins — run it live, not from a screenshot.

### `POST /admin/accounts/:id/freeze` · `/unfreeze`
`{ "reason": "..." }` — reason is mandatory and audited. A frozen account **can still receive**; only sending is blocked.

### `POST /admin/accounts/:id/rebuild-balance`
Recomputes the cached balance from ledger entries. `{ "before_paisa": ..., "after_paisa": ..., "drift_paisa": 0 }` — recovery you can actually run on stage.

### `GET /admin/disputes?state=OPEN&limit=&cursor=` — the admin queue
Each row embeds enough to decide without a second call: the disputed transaction, both parties, the reason, and whether a reversal is currently possible.
```jsonc
{ "items": [ {
    "id": 12, "state": "OPEN", "reason": "Sent to the wrong number",
    "raised_by": { "id": 42, "name": "Rahim A.", "role": "sender" },
    "transaction": { "id": 1043, "ref": "TXN_01J8...", "amount_paisa": 250000,
                     "state": "COMPLETED", "created_at": "..." },
    "counterparty": { "id": 43, "name": "Karim U." },
    "reversible_now": true,          // receiver's balance still covers it
    "attempts": 0, "last_attempt_error": null
  } ], "next_cursor": null, "has_more": false }
```
`reversible_now` is advisory only — it is computed at read time and the receiver can spend the money a millisecond later. The resolve call re-checks inside its own transaction. **Never gate the reversal on this field.**

### `POST /admin/disputes/:id/resolve`  **idempotent, step-up**
```jsonc
// → { "action": "REVERSE", "resolution": "Confirmed wrong recipient, funds returned." }

// ← 200 REVERSE succeeded
{ "dispute": { "id": 12, "state": "REVERSED", "resolved_by": 1, "resolution": "..." },
  "reversal": { "id": 1099, "ref": "TXN_01J9...", "kind": "REVERSAL" } }

// ← 200 REJECT
{ "dispute": { "id": 12, "state": "REJECTED", "resolution": "..." } }

// ← 402 INSUFFICIENT_FUNDS — the receiver already spent it
{ "error": "INSUFFICIENT_FUNDS",
  "message": "Karim's balance is ৳400.00, the reversal needs ৳2,500.00",
  "details": { "dispute_state": "OPEN", "attempts": 1 } }
```
`resolution` text is **mandatory** and enforced by a DB constraint — a dispute cannot leave `OPEN` without it.

`REVERSE` runs the ordinary reversal path in one transaction: it creates a `REVERSAL` transaction with mirrored entries, CASes the original `COMPLETED → REVERSED`, and CASes the dispute `OPEN → REVERSED`, all atomically.

**If the receiver already spent the money the whole thing rolls back**, the dispute **stays `OPEN`**, and the failure is recorded on `attempts` / `last_attempt_error`. We deliberately did not invent a `REVERSAL_FAILED` state: the dispute genuinely is still open, the admin can retry once the receiver's balance recovers, or reject it. Volunteer this to a judge — *we do not fabricate money to resolve a dispute.*

Every resolution writes `ledger.audit_log` with actor, before/after JSONB, and the reason.

### `POST /admin/limits/:userId`  **step-up**
`{ "daily_send_limit_paisa": 10000000, "reason": "..." }`

### `GET /admin/outbox?state=unprocessed|dead` · `POST /admin/outbox/:id/replay`
Monitor and manually replay stuck events.

### `GET /admin/audit?entity=&entity_id=&actor_id=&limit=&cursor=`
### `GET /admin/system-accounts`
Shows `SYSTEM_MINT` at a large negative balance. Have the explanation ready: it is the money supply, negative is correct, and `SUM(entries)` across the whole ledger is still exactly zero.

### `POST /admin/partitions/next-month`
Creates next month's `entries` partition **and attaches the balance trigger to it**. A partition without that trigger is a silent hole in the conservation guarantee.

---

## Caching (Read Service)

The Read Service fronts its queries with Redis. Two rules govern every cached value:

**1. The balance is never cached.** It is a primary-key lookup already sitting in `shared_buffers` — microseconds — and it is simultaneously the highest-write-rate and highest-correctness value in the system. Caching it buys nothing and costs a coherence problem.

**2. Cache reads are version-keyed, not invalidated.** Every key embeds the user's cache version:

```
u:{uid}:v                                  -- INCR'd by the Kafka consumer
hist:{uid}:{v}:{cursor}:{filter}    120s
limits:{uid}:{v}:{yyyymmdd}         to midnight
notif:unread:{uid}:{v}              120s
lookup:{phone}                      300s   -- not user-versioned; profile changes are rare
```

A `DEL`-based cache has a real race: a reader can load stale rows from Postgres, and write them into the cache *after* the invalidation arrives, poisoning the key until its TTL. With version-keyed reads that same race still happens — but the stale reader writes to the **previous version's key**, which nothing will ever read again. It expires unread.

> **Say it like this:** *"We don't invalidate the cache. We make stale keys unreachable."*

Cache headers on every cached response so this is visible in the demo:
```
X-Cache: HIT | MISS | BYPASS
X-Cache-Version: 7
```

**Redis being down is not an error.** Every cache call is wrapped so a failure falls through to Postgres and the request still succeeds — degraded, not broken. `GET /admin/health` reports `redis.ok: false` while this is happening.

---

## Kafka topics

Published by the outbox relay after commit. Give every topic **12–24 partitions even with one consumer** — partition count is the consumer-concurrency ceiling and repartitioning later breaks ordering. It is the one number here that is expensive to change.

| Topic | Payload | Consumed by |
|---|---|---|
| `txn.completed` | full transaction + both legs | Read Service (notifications), Centrifugo bridge |
| `txn.reversed` | reversal + original | Read Service, Centrifugo bridge |
| `txn.held` | held transfer + `settle_after` | Centrifugo bridge (undo countdown) |
| `request.created` | money request | Read Service (notify payer) |
| `request.settled` | request + settling txn | Read Service (notify requester) |
| `fraud.velocity` | sender, count, window | fraud consumer (P2) |

Every message carries `event_id` (the `outbox.id`) so consumers can deduplicate. **Consumers must be idempotent** — Kafka is at-least-once and the offset commits after the DB write, so redelivery on crash is the normal path, not an edge case.
