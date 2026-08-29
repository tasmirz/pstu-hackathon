# UI Spec — Money Movement App

For **D**, built against this from 10:00 on mock data, wired to the real API/Centrifugo starting Phase 3. Matches the demo script in [PLAN.md](PLAN.md). Phase 4 is 40 minutes — everything below is marked **build** or **cut**; don't reorder that under pressure.

**Visual direction:** plain. This is 10% of marks and the judges are watching the ledger, not the UI. One accent color, system font stack, generous whitespace, no animation beyond what's specified for the live-update moment. A clean plain screen beats a half-themed one.

---

## Screen inventory

| # | Screen | Priority |
|---|---|---|
| 1 | Login / Register | build |
| 2 | Dashboard | build |
| 3 | Send Money (3-step) | build |
| 4 | Request Money — create | build |
| 5 | Request Money — inbox | build |
| 6 | Transaction History | build |
| 7 | Ledger Integrity | build — **this screen is UI that sells the backend** |
| 8 | Reversal / dispute | cut first if behind |
| 9 | Undo-window countdown | cut first if behind (tied to the Phase 2 item of the same name — build this only if that shipped) |
| 10 | Freeze notice | cut if behind |

```
Login ──▶ Dashboard ─┬─▶ Send (3 steps) ─▶ success ─▶ Dashboard
                     ├─▶ Request: create / inbox
                     ├─▶ History ─▶ txn detail ─▶ (Reverse)
                     └─▶ Ledger Integrity
```

---

## 1. Login / Register

Single screen, tab-switch between the two — don't build separate routes.

**Login:** phone, PIN (4-digit numeric keypad input, masked). Submit → `POST /auth/login`.
**Register:** phone, name, PIN, confirm PIN. Submit → `POST /auth/register` → toast **"৳100,000 added to your account"** — say the number, it's the brief's own line and it's a free trust signal.

States:
- Validating (button spinner, inputs disabled)
- Wrong PIN → inline error under the PIN field, don't clear the phone number
- **Locked out** (5 failed attempts) → replace the form with *"Too many attempts. Try again in Xm."* — this is a real backend feature, don't let the UI hide it
- Success → store tokens, route to Dashboard

Store access token in memory, refresh token wherever's fastest for the hackathon (localStorage is fine here — this is a demo, not a bank). Silent-refresh on 401 before showing anything broken.

---

## 2. Dashboard

```
┌──────────────────────────────────┐
│  ৳ 97,500.00                    │  ← large, top-left, updates live (Centrifugo)
│  Hi, Rahim                       │
├──────────────────────────────────┤
│  [ Send ]   [ Request ]          │  ← two big buttons, not a menu
├──────────────────────────────────┤
│  Recent activity           See all→│
│  ─ Sent ৳2,500 to Karim   2m ago │
│  ─ Received ৳1,200 from... 1h ago│
│  ─ Money request from Alam       │  ← pending requests surface here too
└──────────────────────────────────┘
```

- Balance comes from `GET /accounts/me/balance` on load — **hits the primary, not the read replica seam** (read-your-own-writes; see PLAN.md).
- Balance **also** updates on the Centrifugo `txn.completed` event without a refetch — this is the live-update moment from the demo script. Briefly flash/highlight the number when it changes (CSS transition, not a toast — don't cover the number that's the whole point).
- Recent activity: last 5 transactions, tapping "See all" → History.
- A pending money-request row is clickable → Request inbox.
- If `status = FROZEN`: red banner, *"Your account is frozen. You can still receive money."* Send button disabled, not hidden — hidden makes the demo look broken when someone clicks where it used to be.

---

## 3. Send Money — three explicit steps, never collapse them

This is the centerpiece flow. Each step is its own screen/modal, not one long form — the step boundary is what sells "recipient confirmation" and "duplicate-send guard" as real features rather than incidental validation.

**Step 1 — Recipient + amount**
```
To: [ phone number input                ]
    → on blur/debounce: GET /users/lookup?phone=
    → resolves to a name chip: "Karim Uddin ✓" or "No user found"
Amount: [ ৳ 0.00 ]           Note: [ optional ]
[ Continue ]  — disabled until recipient resolves and amount > 0
```
- Reject self-transfer client-side immediately (own phone number) with an inline message — the backend also rejects it, this just saves a round trip.
- Amount input: numeric keypad on mobile, format as currency, **store/send as integer paisa** — never let a float touch the network.

**Step 2 — Confirm**
```
You're sending

        ৳ 2,500.00
        to Karim Uddin
        +8801xxxxxxxxx

[ ⚠ You sent ৳500 to this number 90 seconds ago. Send again? ]
   ← only shown if the duplicate-send guard trips (see below)

[ Cancel ]                          [ Confirm & Send ]
```
- **This screen is the recipient-name-confirmation feature.** The name in large text is the point — a typo'd digit resolves to the wrong name and the user catches it here, not after the money's gone.
- Duplicate-send guard: client checks the local "recent sends" cache (last N sends this session) for same-recipient-similar-amount within ~2 min; if it matches, show the warning inline, require an extra tap. This is a UX nicety in front of a real backend velocity check — don't block on the backend round-trip to show it.
- If amount exceeds the step-up threshold: PIN or TOTP re-entry appears **inline on this screen**, not a separate page — don't make the user lose their place.

**Step 3 — Result**
- Submit `POST /transfers` with a **freshly generated idempotency key stored client-side before the request fires** (not generated in the response handler — if the request times out and the user taps Confirm again, it must reuse the same key). Disable the Confirm button the instant it's tapped.
- Success → confirmation screen with the new balance, auto-route to Dashboard after ~2s or on tap.
- `InsufficientFunds` (402) → inline error on this same screen, amount field refocused, balance shown for reference. Never a generic "something went wrong."
- Network/timeout → **retry with the same idempotency key**, not a new one. Say this explicitly in code review — it's the one place a frontend bug turns into a double-debit demo failure.

---

## 4/5. Money Requests — create + inbox

**Create** (mirrors Send step 1/2, minus the money leaving anyone yet):
```
Request from: [ phone ]  → resolves to name
Amount: [ ৳ 0.00 ]   Note: [ optional ]
[ Send Request ]
```
No PIN/TOTP step-up here — no money moves on creation.

**Inbox** — list of requests where you're the payer, `state = PENDING`:
```
┌──────────────────────────────────┐
│ Alam requests ৳1,200              │
│ "for the ticket"          2h left │
│                [Decline] [ Pay ]  │
└──────────────────────────────────┘
```
- **Pay** routes through the *same* Send confirm step (Step 2/3 above) — same idempotency, same step-up rules. Don't build a separate settle-money path in the UI; it's one backend call (`POST /money-requests/:id/pay`) wearing the transfer confirm screen.
- **Decline** is a single tap, no confirm modal — declining isn't destructive to anyone's balance.
- Expired requests: greyed out row, *"Expired"*, no buttons. Don't just delete them from the list — a request that vanishes silently reads as a bug.
- A tab or filter for "Sent by me" (requester side) is optional — cut first if the inbox alone is behind.

---

## 6. Transaction History

```
Sent ৳2,500 to Karim Uddin              −৳2,500
Aug 29, 3:14 PM · TRANSFER

Received ৳1,200 from Alam                +৳1,200
Aug 29, 1:02 PM · REQUEST_SETTLE

Reversed: Sent ৳500 to wrong number       +৳500
Aug 29, 11:40 AM · REVERSAL

[ Load more ]
```
- **Keyset pagination** — "Load more" sends `cursor = <last id>`, never a page number. Matches the backend; also means infinite-scroll works for free later.
- Debits red/left-aligned amount with `−`, credits green with `+`. `kind` shown as a small caption, not the headline — a normal user reads amount and counterparty, not `REQUEST_SETTLE`.
- A `REVERSAL` row visually links back to the original (small "Reversed: ..." prefix as shown) — this is where you prove reversals are new rows, not edits, without saying a word.
- Tap a row → detail view (counterparty, ref, exact timestamp, both ledger legs if you want to be flashy — optional). A `COMPLETED` transfer you sent, within its reversal window, shows a **Reverse** button here → confirm modal → `POST /transactions/:id/reverse`.

---

## 7. Ledger Integrity — the screen that sells the backend

Keep this the plainest screen in the app. No chart, no color-coding beyond pass/fail. It should look like a status page, not a feature.

```
┌──────────────────────────────────┐
│  Ledger Integrity                │
│                                   │
│  Sum of all entries        ✓ ৳0.00 │
│  Balances match ledger     ✓ 200/200 │
│  Negative user balances    ✓ none    │
│                                   │
│  Last checked: just now  [Refresh]│
└──────────────────────────────────┘
```
- Backed by `GET /admin/integrity`. Poll it or hit Refresh on tap — no need for Centrifugo here.
- If anything fails: that row turns red, shows the actual numbers (`Sum: ৳140.00 — expected ৳0.00`), and lists the offending account ids below. Never hide a failure behind a generic red X — if a judge sees this screen fail live, showing *exactly what's wrong* is a better recovery than a vague error.
- This screen needs no auth gate for the demo, but don't route it from the main nav — a direct link/URL is fine, it's a judge-facing proof page, not a user feature.

---

## Cut-line items (build only if Phase 4 is ahead of schedule)

**8. Reversal initiation UI** — if cut, reversals can still be demoed via `curl`/Postman against the History screen's data; not ideal but survivable.

**9. Undo-window countdown** — a persistent bar/chip on Dashboard: *"৳10,000 to Karim — 47s to cancel [Undo]"* while a transfer is `HELD`. Only worth building if the backend feature (PLAN.md Phase 2, item 10) actually shipped — don't build UI for a state machine that isn't there.

**10. Freeze notice** — covered minimally by the Dashboard banner above; a dedicated admin screen to freeze/unfreeze accounts for the demo is the cuttable part, not the banner itself.

---

## Cross-cutting rules

- **Every amount, everywhere, is formatted from integer paisa** — one `formatPaisa(amount): string` helper, used in every screen. Never let a raw float or a raw paisa integer reach the DOM directly; this is the single most common demo-day inconsistency (one screen shows ৳25.00, another shows ৳2500).
- **Every mutating action carries an idempotency key generated before the request fires**, and retries reuse it. Send, Pay-request, Reverse — all three.
- **Loading states never block the whole screen** unless the action is a page transition. A spinner on the button being tapped, not a full-screen overlay — the app should never look frozen mid-transfer.
- **Errors show the backend's actual reason** (`InsufficientFunds`, `AccountFrozen`, `IdempotencyKeyReuse`) mapped to one plain sentence each — not raw error codes, not a generic toast.
- Centrifugo connection: subscribe on login using the per-user channel token from the gateway (see PLAN.md Phase 2, item 2). If the WS is down, the app still works — it just falls back to polling `GET /accounts/me/balance` after a send. Never let a dropped WS block the send flow.
