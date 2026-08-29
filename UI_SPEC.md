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
| 1 | Login / Register | **P0** | Stitch: **Login / Register** |
| 2 | Dashboard | **P0** | live balance; Stitch: **Dashboard** + HOLD undo bar (added) |
| 3 | Send Money (3 steps) | **P0** | the centerpiece flow; Stitch: **Send Money - Step 1 / Step 2 / Step 3 (Result)** |
| 4 | Transaction History | **P0** | keyset paginated; Stitch: **Transaction History** |
| 5 | Transaction Detail | **P0** | shows both ledger legs; Stitch: **Transaction Detail** |
| 6 | Ledger Integrity | **P0** | *UI that sells the backend*; Stitch: **Ledger Integrity** |
| 7 | Request Money — create | **P1** | Stitch: **Request Money - Step 1** |
| 8 | Request inbox / outbox | **P1** | Stitch: **Money Requests - Inbox & Outbox** |
| 9 | Undo countdown | **P1** | only if the backend HELD flow shipped; Stitch: undo bar on **Dashboard** |
| 10 | Reversal / raise dispute | **P1** | Stitch: **Report a Dispute** |
| 10b | My Disputes | **P1** | tracking list — a dispute must never silently disappear; Stitch: **My Disputes** |
| 10c | Admin dispute queue | **P1** | the only screen where an admin moves money; Stitch: **Admin Dispute Queue / Admin Dispute Resolution** |
| 11 | Limits & velocity display | **P1** | Stitch: **Limits & Velocity** |
| 12 | Notification feed | **P2** | |
| 13 | TOTP enrolment | **P2** | only if backend TOTP shipped |
| 14 | Admin console | **P2** | integrity page already covers the demo; Stitch: **Admin Console & Health Monitor** |
| 15 | Bill Payment — pay a fixed request | **P1** | this is the Money Requests flow (§8), "Bill Payment" is the product name for it |
| 16 | Shared Bill — create | **P1** | new feature, §12; Stitch: **Create a Bill** |
| 17 | Shared Bill — detail / status board | **P1** | new feature, §12; Stitch: **Shared Bill - Detail** |
| 18 | Shared Bill — pay my share | **P1** | new feature, §12 — settles from the payer's normal account, same as Send |

```
Login ──▶ Dashboard ─┬─▶ Send (3 steps) ──▶ result ──▶ Dashboard
                     ├─▶ Request: create / inbox      (= "Bill Payment")
                     ├─▶ Shared Bill: create / detail / pay my share
                     ├─▶ History ──▶ Detail ──┬─▶ Reverse
                     │                        └─▶ Raise dispute ──▶ My Disputes
                     ├─▶ Notifications
                     └─▶ Ledger Integrity   (direct link, not in main nav)
```

---

## 1b. Stitch design reference — screens already designed

All screens below exist in the Stitch project **"Ledger Flow Money Movement"** (`12103859305734439630`), built on the **Kinetic Ledger** design system (designMd in-project). Wire the frontend to match these mocks rather than inventing new layouts:

| Stitch screen | UI_SPEC § |
|---|---|
| Login / Register | §2 |
| Dashboard (+ HOLD undo bar) | §3, §9 |
| Send Money - Step 1 · Step 2 · Step 3 (Result) | §4 |
| Transaction History · Transaction Detail | §5, §6 |
| Report a Dispute · My Disputes | §6b, §6c |
| Ledger Integrity | §7 |
| Request Money - Step 1 · Money Requests - Inbox & Outbox | §8 |
| Limits & Velocity | §10 |
| Admin Dispute Queue · Admin Dispute Resolution · Admin Console & Health Monitor | §10 |
| Create a Bill · Shared Bill - Detail | §11 |

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
        → resolves to:  ✓ Karim U.  ● Good           ← reputation dot + tier label
                        ⚠ First time sending to this number
        → or:           ✗ No user found

Amount  [ ৳ 0.00 ]        Note  [ optional ]

                              [ Continue ]   ← disabled until resolved & amount > 0
```

- Lookup returns **first name + last initial** (`Karim U.`) — enough to catch a typo, not enough to harvest a phonebook. See `API.md`.
- `is_first_time: true` → warning chip, and expect a step-up challenge at step 2.
- **Reputation dot** — from `reputation.tier` in the same lookup response: `EXCELLENT`/`GOOD` green, `FAIR` amber, `LOW` red with the label *"Low trust — extra verification required"*. `score < 30` (`LOW`) means step-up is coming at step 2 regardless of amount (`reason: LOW_REPUTATION_RECIPIENT`) — same inline step-up pattern as the amount-threshold and first-time-recipient cases, not a separate flow. **Never block sending outright on a low score** — it's a signal for the human to weigh, not a ban; the system already has step-up for exactly this reason. State this plainly if asked: reputation informs, it doesn't gate.
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

**Designed in Stitch** as *Send Money - Step 3 (Result)* (project `12103859305734439630`): green-check success card with the amount in large monospace, transaction ref + new balance, a muted auto-return note, and the subtle *"Large transfers can be undone for 60 seconds"* line.

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
- `402` → *"Karim has already spent this money. Raise a dispute instead."* with a button that opens the dispute form pre-filled. **Honest failure beats fake success — volunteer this case to the judges.**
- `409` → *"Already reversed."* and refresh.

**Raise dispute** (either party, within 7 days) → opens the full flow in §6b. Once open, the transaction row shows a `Disputed` chip and the detail screen shows the dispute state and, once resolved, the admin's resolution text. The user sees *why* their dispute was rejected — a dispute that silently disappears is worse than one that is refused.

---

## 6b. Raise a Dispute — full flow — **P1**

A modal from Transaction Detail's `[ Dispute ]` button (shown for any
`COMPLETED` transaction the user is a party to, within the 7-day window —
hide the button rather than let it 422 on tap once the window's obviously
closed, but still handle the 422 if it races).

```
┌────────────────────────────────────────┐
│  Dispute this transaction               │
│  ৳2,500.00 to Karim U. · Aug 29         │
│                                          │
│  What went wrong?                       │
│  [ Sent to the wrong number         ]   │
│  [ (free text, required, 3–500 chars)]  │
│                                          │
│  This does not move any money. An       │
│  admin reviews it and may reverse the   │
│  transaction once you submit.           │
│                                          │
│  [ Cancel ]                [ Submit ]   │
└────────────────────────────────────────┘
```

- `POST /disputes` with `{ txn_id, reason }`. **No step-up, no idempotency
  key** — raising a dispute moves no money, same reasoning as creating a
  money request.
- On success: close the modal, show a toast *"Dispute submitted — we'll
  review it."*, and route to §6c so the user immediately sees where to track
  it. Don't just close the modal and leave them wondering if it worked.
- `409 DISPUTE_ALREADY_OPEN` → *"A dispute is already open on this transaction."* — replace the button with a `View dispute` link to §6c instead of leaving it tappable.
- `422 DISPUTE_WINDOW_CLOSED` → *"Transactions can only be disputed within 7 days."*
- `403 NOT_A_PARTY` → shouldn't be reachable from the UI (button is only shown to sender/receiver); if it somehow fires, generic error and log it — it means the detail screen showed the button to the wrong person.

---

## 6c. My Disputes — **P1**

`GET /disputes` — every dispute the current user has raised, regardless of
state. **Never filter out resolved ones** — a dispute that vanishes from the
list reads as a bug, the exact same principle as expired money requests (§8).
**Designed in Stitch** as *My Disputes* (project `12103859305734439630`): OPEN /
REVERSED / REJECTED cards, the admin's `resolution` text in tinted strips, and a
`View txn` action per row.

```
┌────────────────────────────────────────┐
│  My Disputes                            │
├────────────────────────────────────────┤
│  ● OPEN                                 │
│  ৳2,500.00 to Karim U. · Aug 29         │
│  "Sent to the wrong number"             │
│                          [ View txn ]   │
├────────────────────────────────────────┤
│  ✓ REVERSED                             │
│  ৳800.00 to Alam H. · Aug 27            │
│  "Paid twice for the same order"        │
│  Resolved: "Confirmed duplicate,        │
│  funds returned."                       │
│                          [ View txn ]   │
├────────────────────────────────────────┤
│  ✗ REJECTED                             │
│  ৳300.00 to Nadia S. · Aug 24           │
│  Resolved: "Recipient confirmed         │
│  correct — no error found."             │
│                          [ View txn ]   │
└────────────────────────────────────────┘
```

- `state: OPEN` — pending badge, no resolution text yet, set expectations with *"An admin will review this."*
- `REVERSED` / `REJECTED` — show the admin's `resolution` text verbatim. This is the line that makes a rejected dispute feel resolved rather than ignored.
- `[ View txn ]` deep-links to Transaction Detail (§6), which now shows the same dispute state inline.

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

## 8. Money Requests — **P1** — a.k.a. "Bill Payment" (1:1)

Product-facing name: **Bill Payment**. One person owes one fixed amount to
another — this screen and `POST /money-requests` / `POST /money-requests/:id/pay`
are the whole feature; there's no separate "Bill Payment" endpoint. §12 below
is the *shared* version — several people owing one bill.

**Create** — mirrors Send step 1, with no money moving and no step-up.
**Designed in Stitch** as *Request Money - Step 1* (project `12103859305734439630`), following the Send Money - Step 1 layout: phone field with resolved-recipient chip, amount with balance caption + Use Max, optional note, and a consent info strip — *"Creating a request moves no money. Alam sees your request and approves it before any money leaves."* — then the full-width **Send Request** button.
```
Request from  [ phone ] → ✓ Alam H.
Amount        [ ৳ 0.00 ]     Note [ optional ]
                                    [ Send Request ]
```

**Inbox** (`state=PENDING`, you are the payer). **Designed in Stitch** as *Money Requests - Inbox & Outbox* (project `12103859305734439630`): Incoming/Outgoing tabs, active rows with **Decline** + **Pay** and a "22h left" countdown caption, expired rows greyed with no buttons, and a note strip pointing to the Outgoing tab's Cancel action.
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

Persistent bar on Dashboard while any transfer is `HELD`. **Designed in Stitch** — added to the Dashboard screen (project `12103859305734439630`): a subtle `surface-container-low` bar between the action buttons and Recent Activity, clock icon, `৳10,000.00 to Karim U. · sending in 47s` (monospace amount), small primary **Undo** link.

```
⏱  ৳10,000.00 to Karim U. · sending in 47s          [ Undo ]
```

- Countdown from `settle_after`. At zero, the bar disappears and the balance is unchanged (the money already left at HOLD time) — the receiver's side updates via their own websocket.
- **Undo** → `POST /transfers/:id/cancel`. `409 INVALID_STATE` → *"Too late — that already sent."* and refresh. This will happen in testing; handle it properly, it is a real race and looks deliberate when handled well.
- Do not build this if the backend HELD state didn't ship. UI for a state machine that doesn't exist is worse than no UI.

---

## 10. Smaller screens

**Limits & velocity (P1)** — the Dashboard line plus a small breakdown on tap: daily limit, spent today, remaining, reset time. On `VELOCITY_EXCEEDED`, an inline PIN prompt on the send screen, not a separate page. **Designed in Stitch** as *Limits & Velocity* (project `12103859305734439630`): a "Spent today" progress card (৳4,750 / ৳50,000, flat indigo bar, reset-at-midnight caption) plus a velocity card ("3 of 10 allowed per minute") and the *"Receiving is never capped"* note strip.

**Notification feed (P2)** — `GET /notifications`, unread dot on Dashboard, tap-to-read. Fed by the Kafka consumer, so it also serves as visible proof the event pipeline works.

**TOTP enrolment (P2)** — QR from `otpauth_url` (any small QR lib), then 6-digit confirm, then the 8 backup codes **shown exactly once** with a copy button and an explicit *"save these now"*. Only build if backend TOTP shipped.

### Admin dispute queue — **P1** — *the only screen where an admin moves money*

```
┌──────────────────────────────────────────────────────┐
│  Open disputes  (3)                                   │
├──────────────────────────────────────────────────────┤
│  #12  Rahim A. (sender) disputes ৳2,500.00           │
│       "Sent to the wrong number"                      │
│       TXN_01J8XKQ4 → Karim U. · Aug 29, 3:14 PM      │
│       ● Reversible now                                │
│                            [ Reject ]  [ Reverse ]    │
├──────────────────────────────────────────────────────┤
│  #14  Nadia S. (receiver) disputes ৳800.00           │
│       "Paid twice for the same order"                 │
│       ○ Not reversible — receiver balance ৳400.00    │
│       ⚠ 1 failed attempt: INSUFFICIENT_FUNDS         │
│                            [ Reject ]  [ Reverse ]    │
└──────────────────────────────────────────────────────┘
```

- From `GET /admin/disputes?state=OPEN`.
- **`Reversible now` is advisory, shown greyed rather than disabling the button.** The receiver can spend the money a millisecond after the page loads, so the server re-checks inside its own transaction. Disabling the button on a stale read would be lying to the admin about a guarantee the UI cannot make.
- **Both actions require a resolution note** — the submit button stays disabled until the textarea has content. The backend enforces it with a `CHECK` constraint too; the UI just makes it obvious.
- `Reverse` → `402` → keep the dispute in the list, show *"Reversal failed — Karim's balance is ৳400.00. Retry later or reject."* and increment the visible attempt count. **Do not remove the row.** This is the flow worth rehearsing: it's the one that demonstrates the system refusing to fabricate money.
- Resolved disputes move to a `Resolved` tab showing who resolved them and when.

**Rest of admin console (P2)** — freeze/unfreeze, outbox monitor, load-test trigger. The Integrity page already carries the demo; this is garnish. If you build one more thing, make it the **simulator run button** so the Phase 3 board can be launched from the UI on stage.

---

## 11. Shared Bill Payment — **P1** — new feature

Several payers, one bill, each paying **from their own normal account** —
no wallet, no escrow, no separate balance to top up. A share settlement is
exactly a Send, just triggered from the bill screen instead of the phone
number field. If you've built Send (§4) and Money Requests (§8) already,
every piece here is a recombination of those two, not new mechanics.

### Create

**Designed in Stitch** as *Create a Bill* (project `12103859305734439630`): bill-title input, per-row phone + share amount with resolved-recipient chips and remove buttons, "＋ Add another person", computed **Total ৳800.00**, the *"Creating a bill moves no money"* consent strip, and the full-width **Create Bill** button.
```
Bill title    [ Dinner at Kacchi Bhai              ]

Split with
  [ +8801798765432        ]  ৳ [   400.00 ]   [ ✕ ]   ← Karim U., resolved inline like Send
  [ +8801765432109        ]  ৳ [   400.00 ]   [ ✕ ]   ← Nadia S.
  [ + Add another person                      ]

Total: ৳800.00                        [ Create Bill ]
```

- Same debounced `GET /users/lookup?phone=` resolution as Send's recipient
  field, per row. A row that doesn't resolve blocks submit, same as Send.
- **Total is computed, never typed** — it's the sum of the share amounts
  shown live, matching `POST /bills`' shape exactly (there is nothing to
  keep in sync because there's nothing else to enter).
- A share whose phone is the creator's own is rejected client-side before
  the request even fires (same `422 SELF_TRANSFER` reasoning as Send).
- No step-up here — creating a bill moves no money, exactly like creating a
  money request.
- On success, route straight to the bill's detail screen below.

### Detail / status board

**Designed in Stitch** as *Shared Bill - Detail* (project `12103859305734439630`): OPEN chip, ৳800.00 total, share rows with PAID/PENDING chips, "2 of 2 shares", the *"The bill settles the moment every share is paid"* note, and a full-width **Pay My Share ৳400.00** primary button plus a secondary **Cancel bill**.
```
┌────────────────────────────────────────┐
│  Dinner at Kacchi Bhai            OPEN  │
│  Created by you · Aug 29, 3:14 PM       │
│  ৳800.00 total                          │
├────────────────────────────────────────┤
│  ✓ Karim U.          ৳400.00     PAID   │
│  ○ Nadia S.          ৳400.00  PENDING   │
├────────────────────────────────────────┤
│  2 of 2 shares                          │
│                          [ Cancel bill ]│   ← P2, creator only, only while any share is PENDING
└────────────────────────────────────────┘
```

- `GET /bills/:id`. Each share row is a small version of a transaction row —
  ✓/○ state, name, amount. A `PAID` share links to its own Transaction
  Detail (§6) via `settled_txn_id`, same "show the real ledger row" instinct
  as everywhere else in this app.
- Bill state flips to **SETTLED** the instant every share is `PAID` — this
  is a plain refetch or a Centrifugo-driven update, whichever the transfer
  screen already uses; don't build a second live-update mechanism just for
  this screen.
- If the current user has their own `PENDING` share on this bill, show the
  same big **[ Pay my share ]** button as the inbox row in §8 — don't make
  them hunt for it among the other rows.

### Pay my share

Not a new screen — **route straight into Send's confirm step (§4 step 2)**,
pre-filled with the bill creator as recipient and the share amount locked
(not editable, unlike a normal Send). Same idempotency key discipline, same
step-up rules (first-time-recipient, >৳20,000), same result screen. The one
difference worth stating to a judge: *the money still comes out of the
payer's ordinary balance — a shared bill is a bookkeeping wrapper around
ordinary transfers, not a different kind of money.*

- `POST /bills/:id/pay` (no share id — a payer only ever pays their own share).
- `402 INSUFFICIENT_FUNDS` → identical inline handling to Send step 3.
- `404 BILL_SHARE_NOT_FOUND` → shouldn't be reachable (button only shows when a share exists); generic error if it somehow fires.
- `409 INVALID_STATE` → *"This was already paid."* + refresh the bill detail screen underneath.

---

## 12. Build order for Phase 4's 40 minutes

1. Login → Dashboard → balance renders (10 min)
2. Send, all three steps, happy path + insufficient funds (12 min)
3. Centrifugo live balance update — **two windows side by side** (6 min)
4. History + Detail with the ledger legs (6 min)
5. Ledger Integrity (4 min)
6. Request inbox — "Bill Payment" (P1, if time)
7. Raise dispute + My Disputes (P1, if time — §6b/§6c)
8. Admin dispute queue (P1, if time — 8 min, and it is a distinct demo beat)
9. Shared Bill: create + detail + pay my share (P1, if time — §11, cheap once 2 and 6 exist)
10. Undo bar (P1, if time)

If you reach 14:25 with items 1–5 working and nothing else, the demo is complete. Items 6+ are upside.
