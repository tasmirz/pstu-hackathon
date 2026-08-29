# UI Spec — Money Movement App

**Reader:** D. Build against this from 10:00 on mocks; wire the real API from 13:00.
**Contract:** `API.md` is authoritative for every shape. This file is authoritative for every screen and state.
**Budget:** Phase 4 is 40 minutes. Everything below is marked **P0 / P1 / P2** — build in that order and do not reorder under pressure.

**Visual direction:** plain and confident. This is 10% of the marks and the judges are watching the ledger, not the styling. One accent color, system font stack, generous whitespace, no animation except the one specified for the live-update moment. A clean plain screen beats a half-finished themed one.

---

## 0. Cross-cutting rules — read these before writing any screen

### 0.1 Money

Every monetary field on the wire is named `*_paisa` and is an integer. **One helper, used everywhere, no exceptions:**

```ts
formatPaisa(250000)  // → "৳2,500.00"
parseToPaisa("2500") // → 250000
```

Never let a raw paisa integer or a float reach the DOM. The classic demo-day failure is one screen rendering `৳25.00` where another renders `৳2,500` — the `_paisa` suffix in the API exists specifically so this cannot happen silently, and the helper is the other half of that.

### 0.2 Idempotency — the one frontend bug that becomes a double debit

```ts
const key = crypto.randomUUID();     // BEFORE the request fires
sessionStorage.setItem(`idem:${formId}`, key);
await post('/transfers', body, { 'Idempotency-Key': key });
```

- Generate the key **before** the request, not in the response handler.
- A retry after timeout **reuses the same key**. Minting a new key on retry is how a network blip becomes a double debit.
- Disable the submit button the instant it is tapped.
- A step-up retry (after `403 STEP_UP_REQUIRED`) also reuses the same key.

Applies to: Send, Pay-request, Reverse, Refund, Split, Cancel-held.

### 0.3 Errors

Map the backend's `error` code to one plain sentence each. Never show a raw code, never a generic toast for a known failure.

| Code | What the user sees |
|---|---|
| `INSUFFICIENT_FUNDS` | "Not enough balance. You have ৳500.00." |
| `ACCOUNT_FROZEN` | "Your account is frozen. You can still receive money." |
| `DAILY_LIMIT_EXCEEDED` | "That would pass your ৳50,000 daily limit. ৳4,750 left today." |
| `VELOCITY_EXCEEDED` | "Too many transfers just now — enter your PIN to continue." |
| `STEP_UP_REQUIRED` | inline PIN/TOTP prompt, not an error |
| `INVALID_STATE` | "This was already handled." + refresh the row |
| `IDEMPOTENCY_KEY_REUSE` | "Something changed — please start again." (should never surface) |
| `TOKEN_REUSE_DETECTED` | "You've been signed out for security." → login |

### 0.4 Loading and connection

- Spinner on the **button being tapped**, never a full-screen overlay. The app must never look frozen mid-transfer.
- Centrifugo: subscribe on login with the token from `GET /auth/ws-token`. **If the socket is down the app still works** — fall back to refetching `GET /accounts/me/balance` after each send. Never let a dropped WS block the send flow or hide an error.
- Access token in memory; refresh token in `localStorage` (fine for a demo). Silent-refresh on `401` before anything visibly breaks.

---

## 1. Screen inventory

| # | Screen | P | Notes |
|---|---|---|---|
| 1 | Login / Register | **P0** | |
| 2 | Dashboard | **P0** | live balance |
| 3 | Send Money (3 steps) | **P0** | the centerpiece flow |
| 4 | Transaction History | **P0** | keyset paginated |
| 5 | Transaction Detail | **P0** | shows both ledger legs |
| 6 | Ledger Integrity | **P0** | *UI that sells the backend* |
| 7 | Request Money — create | **P1** | |
| 8 | Request inbox / outbox | **P1** | |
| 9 | Undo countdown | **P1** | only if the backend HELD flow shipped |
| 10 | Reversal / dispute | **P1** | |
| 11 | Limits & velocity display | **P1** | |
| 12 | Notification feed | **P2** | |
| 13 | TOTP enrolment | **P2** | only if backend TOTP shipped |
| 14 | Admin console | **P2** | integrity page already covers the demo |

```
Login ──▶ Dashboard ─┬─▶ Send (3 steps) ──▶ result ──▶ Dashboard
                     ├─▶ Request: create / inbox
                     ├─▶ History ──▶ Detail ──▶ Reverse
                     ├─▶ Notifications
                     └─▶ Ledger Integrity   (direct link, not in main nav)
```

---

## 2. Login / Register — **P0**

One screen, tab-switch between the two. Do not build separate routes.

**Register:** phone, name, PIN, confirm PIN → `POST /auth/register`
→ toast **"৳100,000 added to your account"**. Say the number — it is the brief's own line and a free trust signal.

**Login:** phone, PIN (masked, numeric keypad) → `POST /auth/login`

States:
- Validating — button spinner, inputs disabled
- Wrong PIN — inline error under the PIN field; **do not clear the phone number**; show `attempts_remaining` from the response
- `423 ACCOUNT_LOCKED` — replace the form entirely with *"Too many attempts. Try again in 4m."* This is a real backend feature; don't let the UI hide it
- Success — store tokens, subscribe to Centrifugo, route to Dashboard

---

## 3. Dashboard — **P0**

```
┌────────────────────────────────────────┐
│  ৳ 97,500.00                          │  ← large, top-left, updates LIVE
│  ৳ 10,000.00 held  ⓘ                  │  ← only when held_paisa > 0
│  Hi, Rahim                             │
├────────────────────────────────────────┤
│  [   Send   ]      [  Request  ]       │  ← two big buttons, not a menu
├────────────────────────────────────────┤
│  ⏱ ৳10,000 to Karim · 47s to cancel   │  ← undo bar (P1), only while HELD
│                             [ Undo ]   │
├────────────────────────────────────────┤
│  ৳4,750 of ৳50,000 daily left          │  ← P1, subtle, not alarming
├────────────────────────────────────────┤
│  Recent activity              See all →│
│  ↑ Sent ৳2,500 to Karim U.     2m ago │
│  ↓ Received ৳1,200 from Alam   1h ago │
│  ⇄ Reversed ৳500                3h ago │
│  ✉ Alam requests ৳1,200      [ View ] │
└────────────────────────────────────────┘
```

- Balance from `GET /accounts/me/balance` on load — **hits the primary**, per read-your-own-writes.
- Balance **also** updates from the Centrifugo `txn.completed` event with no refetch. **This is the live-update demo moment.** Flash/highlight the number with a CSS transition when it changes — do **not** cover it with a toast, the number is the point.
- `held_paisa` renders as its own line whenever non-zero, so money that has left but not arrived never looks like missing money.
- `status = FROZEN` → red banner: *"Your account is frozen. You can still receive money."* Send button **disabled, not hidden** — hidden makes the demo look broken when someone taps where it used to be.

---

## 4. Send Money — three explicit steps — **P0**

Each step is its own screen or modal. **Never collapse them into one form.** The step boundary is what makes recipient confirmation and the duplicate-send guard read as deliberate features rather than incidental validation.

### Step 1 — Recipient + amount

```
To      [ +8801798765432                    ]
        → debounced GET /users/lookup?phone=
        → resolves to:  ✓ Karim U.
                        ⚠ First time sending to this number
        → or:           ✗ No user found

Amount  [ ৳ 0.00 ]        Note  [ optional ]

                              [ Continue ]   ← disabled until resolved & amount > 0
```

- Lookup returns **first name + last initial** (`Karim U.`) — enough to catch a typo, not enough to harvest a phonebook. See `API.md`.
- `is_first_time: true` → warning chip, and expect a step-up challenge at step 2.
- Self-transfer: reject client-side immediately on own phone number, inline message. The backend rejects it too; this just saves a round trip.
- Amount: numeric keypad on mobile, currency-formatted, converted to integer paisa on submit. **No float ever touches the network.**

### Step 2 — Confirm  ← *this screen is the recipient-confirmation feature*

```
        You're sending

           ৳ 2,500.00
           to  Karim U.
           +8801798765432

  ⚠ You sent ৳500 to this number 90 seconds ago.
     Send again?                          [ Yes, send ]

  ── step-up, inline, only when required ──
  Enter your 6-digit code   [ ______ ]

  [ Cancel ]                        [ Confirm & Send ]
```

- **The name in large type is the whole point.** A mistyped digit resolves to a different person and the user catches it here, not after the money has gone.
- Duplicate-send guard: check a client-side cache of recent sends (same recipient, similar amount, <120s) and show the warning inline requiring an extra tap. Don't wait on a backend round-trip to display it — the backend velocity check is the real guard, this is the humane one.
- Step-up appears **inline on this screen**, never as a separate page. Don't make the user lose their place mid-transfer.

### Step 3 — Result

- `201` → success screen with the new balance (taken from `balance_paisa` in the response, **not** a refetch), auto-route to Dashboard after ~2s or on tap.
- `202` + `state: HELD` → success screen showing *"Sending in 60s — you can still cancel"* and the undo bar appears on Dashboard.
- `402 INSUFFICIENT_FUNDS` → inline error on **this same screen**, amount refocused, current balance shown for reference. Never a generic "something went wrong".
- `403 STEP_UP_REQUIRED` → reveal the step-up field on step 2, retry **with the same idempotency key**.
- Network/timeout → retry **with the same idempotency key**. Flag this in code review; it is the one frontend bug that becomes a live double-debit.

---

## 5. Transaction History — **P0**

```
↑ Sent ৳2,500 to Karim U.                      −৳2,500.00
  Aug 29, 3:14 PM · TRANSFER

↓ Received ৳1,200 from Alam H.                 +৳1,200.00
  Aug 29, 1:02 PM · REQUEST_SETTLE

⇄ Reversed: Sent ৳500 to wrong number            +৳500.00
  Aug 29, 11:40 AM · REVERSAL

                                          [ Load more ]
```

- **Keyset pagination.** "Load more" sends `cursor=<last id>`, never a page number. Matches the backend and gives infinite scroll for free later.
- Debits: red, `−`. Credits: green, `+`. `kind` is a small caption, never the headline — a normal user reads *amount* and *counterparty*, not `REQUEST_SETTLE`.
- A `REVERSAL` row shows the *"Reversed: …"* prefix linking to the original. **This is where you prove reversals are new rows rather than edits, without saying a word.**
- Filters (P1): sent / received / reversed.

---

## 6. Transaction Detail — **P0**

The cheapest high-value screen in the app: the ledger legs are already in the response.

```
┌────────────────────────────────────────┐
│  ৳2,500.00 to Karim U.                 │
│  COMPLETED · Aug 29, 3:14 PM           │
│  Ref  TXN_01J8XKQ4...                  │
│  Note "lunch"                          │
├────────────────────────────────────────┤
│  Ledger entries                         │
│  Account #84  (USER)        −৳2,500.00 │
│  Account #86  (USER)        +৳2,500.00 │
│  ─────────────────────────────────────  │
│  Sum                              ৳0.00 │  ← always. leave it visible.
├────────────────────────────────────────┤
│                        [ Reverse this ] │  ← only when can_reverse
└────────────────────────────────────────┘
```

That `Sum ৳0.00` line makes double-entry visible to a judge who never opens the code. Leave it on screen.

**Reverse** → confirm modal with a mandatory reason → `POST /transactions/:id/reverse`.
- `402` → *"Karim has already spent this money. Raise a dispute instead."* with a button to do so. **Honest failure beats fake success — volunteer this case to the judges.**
- `409` → *"Already reversed."* and refresh.

---

## 7. Ledger Integrity — **P0** — *the screen that sells the backend*

Keep this the plainest screen in the app. No chart, no gradient. It should look like a status page, not a feature.

```
┌────────────────────────────────────────┐
│  Ledger Integrity                       │
│                                         │
│  Sum of all entries          ✓  ৳0.00   │
│  Balances match ledger       ✓  200/200 │
│  Negative balances           ✓  none    │
│  Hash chain verified         ✓  40,188  │
│                                         │
│  Checked just now         [ Refresh ]   │
└────────────────────────────────────────┘
```

- From `GET /admin/integrity`. Refresh on tap; no websocket needed.
- **On failure show the actual numbers**: `Sum: ৳140.00 — expected ৳0.00`, and list offending account ids beneath. Never hide a failure behind a generic red X — if this fails live, showing exactly what broke is a far better recovery than a vague error.
- Reachable by direct URL, **not** from the main nav. It is a judge-facing proof page, not a user feature.

---

## 8. Money Requests — **P1**

**Create** — mirrors Send step 1, with no money moving and no step-up:
```
Request from  [ phone ] → ✓ Alam H.
Amount        [ ৳ 0.00 ]     Note [ optional ]
                                    [ Send Request ]
```

**Inbox** (`state=PENDING`, you are the payer):
```
┌────────────────────────────────────────┐
│  Alam H. requests ৳1,200.00             │
│  "for the ticket"           22h left    │
│                    [ Decline ] [ Pay ]  │
└────────────────────────────────────────┘
```

- **Pay routes through the Send confirm screen** (step 2 → 3), same idempotency, same step-up rules — one backend call (`POST /money-requests/:id/pay`) wearing the transfer confirm UI. Do not build a second settle flow.
- **Decline** is one tap, no modal — declining moves nobody's money.
- Expired requests render greyed with *"Expired"* and no buttons. **Never silently omit them** — a request that vanishes reads as a bug.
- Outbox tab (requests you sent) with a Cancel action while `PENDING`. Cut this tab first if behind.

---

## 9. Undo Countdown — **P1** — *build only if the backend HELD flow shipped*

Persistent bar on Dashboard while any transfer is `HELD`:

```
⏱  ৳10,000.00 to Karim U. · sending in 47s          [ Undo ]
```

- Countdown from `settle_after`. At zero, the bar disappears and the balance is unchanged (the money already left at HOLD time) — the receiver's side updates via their own websocket.
- **Undo** → `POST /transfers/:id/cancel`. `409 INVALID_STATE` → *"Too late — that already sent."* and refresh. This will happen in testing; handle it properly, it is a real race and looks deliberate when handled well.
- Do not build this if the backend HELD state didn't ship. UI for a state machine that doesn't exist is worse than no UI.

---

## 10. Smaller screens

**Limits & velocity (P1)** — the Dashboard line plus a small breakdown on tap: daily limit, spent today, remaining, reset time. On `VELOCITY_EXCEEDED`, an inline PIN prompt on the send screen, not a separate page.

**Notification feed (P2)** — `GET /notifications`, unread dot on Dashboard, tap-to-read. Fed by the Kafka consumer, so it also serves as visible proof the event pipeline works.

**TOTP enrolment (P2)** — QR from `otpauth_url` (any small QR lib), then 6-digit confirm, then the 8 backup codes **shown exactly once** with a copy button and an explicit *"save these now"*. Only build if backend TOTP shipped.

**Admin console (P2)** — freeze/unfreeze, disputes, outbox monitor, load-test trigger. The Integrity page already carries the demo; this is genuine garnish. If you build one thing here, make it the **load-test button** so §Phase 3 can be run from the UI on stage.

---

## 11. Build order for Phase 4's 40 minutes

1. Login → Dashboard → balance renders (10 min)
2. Send, all three steps, happy path + insufficient funds (12 min)
3. Centrifugo live balance update — **two windows side by side** (6 min)
4. History + Detail with the ledger legs (6 min)
5. Ledger Integrity (4 min)
6. Request inbox (P1, if time)
7. Undo bar (P1, if time)

If you reach 14:25 with items 1–5 working and nothing else, the demo is complete. Items 6+ are upside.
