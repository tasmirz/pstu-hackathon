# Assignment: DeepSeek — Reputation UI + backlog cleanup

Your track stays the same as established in `BUILD_LOG_DEEPSEEK.md`: Stitch
mocks + `UI_SPEC.md`. You don't touch `apps/api/**`, the `frontend/` React
code, or infra. Stitch project **"Ledger Flow Money Movement"**,
id `12103859305734439630`, design system **"Kinetic Ledger"**
(`assets/da43ec6052af406ab60038e603948426`).

Before starting, re-read your own last log entry — the three screens you
flagged as concurrently added by someone else (**Request Money - Create**
`d41cc673b30341079b4e68c84942fa63`, **Money Requests Management**
`21d9addeb1c044baac011740242056f7`, **Admin Console & Health Monitor**
`12b91dd9867648f98ece5ea45e362b38`) may still be there — check before
generating a duplicate of anything that overlaps.

---

## Primary task: Reputation

A new feature landed backend-side: every user has a derived trust score
(`0`–`100`, tiers `EXCELLENT`/`GOOD`/`FAIR`/`LOW`) returned by
`GET /users/lookup` as `reputation: { score, tier }`. Full contract,
including the honest limitation about not being able to determine fault in
a dispute (worth keeping in mind for tone — this is a soft trust signal,
not an accusation), is in `API.md` under **"Reputation"**. `UI_SPEC.md` §4
step 1 already has a text-mode sketch of where this shows first:

```
To      [ +8801798765432                    ]
        → resolves to:  ✓ Karim U.  ● Good
```

### What to design

1. **A reusable reputation indicator** — small dot/chip + tier label,
   Kinetic Ledger tokens: `EXCELLENT`/`GOOD` → success green, `FAIR` →
   warning amber, `LOW` → error/danger red with the label text *"Low
   trust"*. This needs to slot into an inline row next to a resolved name,
   so keep it compact — think a colored dot + one word, not a full badge
   component with icon+border+padding fighting the name for attention.
   **The name stays the visually dominant element** — reputation is a
   secondary signal, not equal billing (same hierarchy principle as the
   existing "first name + last initial, not full name" masking decision).
2. **Apply it everywhere a resolved recipient/counterparty already
   appears from a phone lookup**:
   - Send Money - Step 1 (lookup result row) — edit in place if it already
     exists in Stitch, otherwise generate.
   - Request Money - Create (the payer's resolved name) — check whether
     `d41cc673b30341079b4e68c84942fa63` (the concurrently-added one) or
     your own `d8b8f390bb8a46c08e1800b4fcb1e242` is the canonical one before
     editing; don't fork both.
   - Create a Bill (`d1e44e5cd924436a9e8301dd0e486643`) — each participant
     row, since every one of them is a phone-lookup result.
3. **A `LOW` state on Send Money - Step 2 (Confirm)**: when the resolved
   recipient is `LOW` tier, the step-up prompt appears **unconditionally**
   (not just for first-time/large-amount) with a slightly different lead-in
   line than the existing ones — something like *"This recipient has a low
   trust score — please verify to continue."* rather than the generic
   first-time-recipient or amount-threshold copy. Reuse the existing inline
   step-up field placement (§4 step 2) — this is a new *reason* the field
   appears, not a new field.

## Backlog cleanup — pick up items from your own "not yet designed" list

Two are worth doing now, low effort, real value:

4. **Frozen-account banner state on Dashboard (§3)** — the red banner
   *"Your account is frozen. You can still receive money."* with the Send
   button visibly disabled (not hidden — a hidden button where one used to
   be reads as broken on stage). Edit the existing Dashboard screen
   (`fdf0d88655ea46f4974f976d0f8b3b48`) to add this as a state variant
   rather than a new screen.
5. **Transaction History with a `REVERSAL` row (§5)** — the
   `⇄ Reversed: Sent ৳500 to wrong number` row style linking back to the
   original transaction. This is the row that makes reversals visibly "new
   rows, not edits" without anyone reading code — worth getting right.

Leave **Notification feed**, **TOTP enrolment**, and **duplicate-send guard
warning state** for a later round — P2/lower value relative to the above.

## Update `UI_SPEC.md` to match

Same discipline as your last entry: note the Stitch screen id next to each
spec section you touch (§4 step 1/2, §8 create, §11 create, §3, §5), and
add a short "Reputation" note near §4 step 1 pointing at `API.md`'s new
section, mirroring how §6b/§6c already point at the Disputes contract.

## Verified, before you hand off

Confirm every screen you touch or create via `get_screen`, and run
`git diff UI_SPEC.md` (or the doc-equivalent check) to confirm only
`UI_SPEC.md` + your build log changed — no backend/frontend files, same
rule as last time.

## Log your work

Append to `BUILD_LOG_DEEPSEEK.md` (newest entry on top, same format as your
existing entry — what changed, screens table, decisions worth keeping,
anything concurrent/conflicting you noticed, what's still not designed).
