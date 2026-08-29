# Assignment: Antigravity — Round 2: HOLD / 60-Second Undo Window

## Round 1 — done, verified, thank you

Disputes, Bill Payment (1:1), and Shared Bill Payment all landed
(`df0dee5`) and pass `node scripts/test-antigravity.js` end to end,
including the two-phase dispute-failure shape (§4.3) and the ledger
invariant checks (conservation, no drift, no negative balances). That work
stands as-is — nothing in this round asks you to revisit it, except where
noted in "Touches your existing code" below.

Codex's bootstrap (`main.ts`/`app.module.ts`/`AuthModule`) is still
outstanding, so full HTTP-level integration testing of this round will also
have to wait — same workaround as last time: seed users directly via the
`AUTH_POOL`-shaped connection in a test script, the way
`scripts/test-antigravity.js` already does, rather than going through
`/auth/register`.

---

## The feature

PLAN.md §4.2 calls this the showpiece, and it's the one substantial P1
ledger feature nobody has built yet: **a transfer above a threshold
(`config.undoThresholdPaisa`, currently ৳5,000 = `500000` paisa) doesn't
complete immediately.** The sender is debited right away — the money is
already gone and cannot be double-spent — but it lands in the sender's own
`HOLD` account instead of the receiver's, for `config.undoWindowSeconds`
(60s in prod, the simulator will later set this to 3s via env — see
`SIMULATOR.md` §3.4, don't hardcode the window anywhere but `config.ts`,
it's already there). The sender can cancel within the window (money comes
straight back); otherwise a sweeper settles it automatically once the
window closes.

**The load-bearing design rule**: *a held transfer is two separately
balanced transactions, never one three-legged one.*

```
Send ৳10,000 (above threshold)
  TXN1  kind=TRANSFER  state=HELD
        entries: sender −10,000 · HOLD(sender) +10,000        ← balanced, commits NOW
        settle_after = now() + undoWindowSeconds

  settle (sweeper, after window)        cancel (user taps Undo, inside window)
  TXN2 kind=HOLD_SETTLE                 TXN2' kind=HOLD_CANCEL
    HOLD(sender) −10,000                  HOLD(sender) −10,000
    receiver     +10,000                  sender       +10,000
    parent_txn_id = TXN1                  parent_txn_id = TXN1
    CAS TXN1 HELD → COMPLETED             CAS TXN1 HELD → CANCELLED
```

Three independent things stop a double-settle (all three, not just one —
this is what the simulator's `HLD`/`CON-04` scenarios will eventually
probe): the **CAS** (`WHERE id=$1 AND state='HELD'` — the loser updates 0
rows), the **row lock** (`FOR UPDATE` on the HOLD account serializes settle
vs. cancel), and the **`CHECK (balance >= 0)`** on the HOLD account itself
(already in `SCHEMA.sql` — HOLD is non-`SYSTEM_MINT`, so it's covered).

**HOLD accounts are per-user, never global** — `AccountsRepository.getOrCreateHoldAccountId`
already exists for exactly this and already handles the lazy-create (no
migration needed, `ledger.accounts` already supports `type='HOLD'`, one per
user via the existing partial unique index).

---

## Touches your existing code — the one integration point

`modules/ledger/core/ledger-writer.port.ts` / `.service.ts`'s `moveMoney`
currently resolves **both** sides via `AccountsRepository.getUserAccountId`
(`type='USER'` only) — it cannot move money into or out of a `HOLD`
account as written. You have two reasonable options; pick whichever is
less invasive once you're looking at the real code:

1. **Extend `MoveMoneyParams`** with optional `senderAccountId` /
   `receiverAccountId` overrides — when present, skip the `USER`-account
   lookup for that side and use the override directly (still lock both
   accounts ascending, still run the same frozen/insufficient-funds checks
   against whichever account is actually debited). This keeps one code
   path for every double-entry write, HOLD included.
2. **Add a sibling method** on the same port/service,
   e.g. `moveBetweenAccounts(client, {senderAccountId, receiverAccountId,
   senderUserIdForFrozenCheck, amountPaisa, kind, parentTxnId,
   skipDailyLimitCheck})`, and have `moveMoney` call it internally after
   resolving both `USER` accounts. Slightly more code, keeps `moveMoney`'s
   existing signature untouched (which Transfers/Requests/Bills/Reversals
   all already depend on — don't break their call sites).

Either is fine. **Do not duplicate the lock-order/CAS/entries-insert logic
in a new file outside `ledger-writer.service.ts`** — that file is the one
place double-entry actually happens, across every feature in this app; a
second copy of it is exactly the kind of drift that produces a ledger bug
nobody catches until demo day.

## What to build

### 1. `TransfersService` — the threshold branch

In `modules/ledger/transfers/transfers.service.ts`, after the existing
step-up checks and before the plain-transfer `moveMoney` call: if
`amountPaisa > config.undoThresholdPaisa`, take the HELD path instead —
insert `ledger.transactions` directly (`kind='TRANSFER', state='HELD',
sender_id, receiver_id=<intended receiver, informational — the entries
don't touch their account yet>, amount, settle_after = now() +
undoWindowSeconds * interval '1 second'`), write the two entries
(`senderAccountId -amount`, `senderHoldAccountId +amount`), update both
balances, write the outbox row (`topic='txn.held'`, per `API.md`'s Kafka
topics table — even though nothing consumes it yet, the row should exist,
same reasoning as everywhere else: the outbox is the durability boundary,
not the consumer). Return the `202` shape from `API.md`:
```jsonc
{ "transaction": { "id":.., "state":"HELD", "settle_after":"...", ... },
  "balance_paisa": ..., "can_cancel_until": "<settle_after>" }
```
Controller: change `TransfersController.create`'s `@HttpCode(201)` to
branch — `201` for the immediate-COMPLETED path (unchanged), `202` for
HELD. Easiest: have the service return `{ ..., httpStatus }` or just always
return `202` when `state === 'HELD'` — check what's cleanest given the
existing controller, you have freedom here as long as `API.md`'s two
response shapes are both reachable.

### 2. `POST /transfers/:id/cancel` — idempotent, new endpoint

New method on `TransfersService` (or a small `HoldsService` alongside it —
your call): inside `withTransaction`, claim idempotency key (keyed on the
caller), `SELECT ... FOR UPDATE` the transaction, `TxnNotFound` if missing,
`NotAParty` unless caller is the sender, `InvalidState` (409) if
`state !== 'HELD'` or `settle_after` has already passed (the sweeper may
have won the race — that's a normal, expected 409, not a bug). CAS
`HELD -> CANCELLED`, write the `HOLD_CANCEL` transaction (`parent_txn_id =
original.id`, entries `HOLD(sender) -amount`, `sender +amount`). Return
`{transaction, balance_paisa}` per `API.md`.

### 3. The sweeper

A simple `setInterval` (or a Nest `@Interval()` from `@nestjs/schedule` if
you'd rather add that dependency — either is fine, don't over-build this)
running every `config.sweeperIntervalMs`, querying:
```sql
SELECT id FROM ledger.transactions
 WHERE state = 'HELD' AND settle_after <= now()
 ORDER BY id
 FOR UPDATE SKIP LOCKED
 LIMIT 100
```
For each: inside its own `withTransaction`, re-check `state='HELD'` under
the lock (belt-and-suspenders against a concurrent cancel — the CAS below
is the real guard), CAS `HELD -> COMPLETED`, write the `HOLD_SETTLE`
transaction (`parent_txn_id = original.id`, entries `HOLD(sender)
-amount`, `receiver +amount`), write the `txn.completed` outbox row (same
topic a normal completed transfer uses — from the receiver's perspective,
money has now genuinely arrived, which is exactly what that topic means).
`SKIP LOCKED` matters even with one sweeper instance today — it's what
makes running two instances later (for scaling) safe with zero code
changes, and it's cheap to get right now while you're already here.
Wire the sweeper's start-up into `TransfersModule` (`OnModuleInit`) or a
tiny dedicated `SweeperModule` — whichever reads cleaner to you.

### 4. `GET /accounts/me/balance`'s `held_paisa` — coordinate, don't build

This is Codex's `QueryModule`, not yours — it already reads the user's
`HOLD` account balance (falling back to `0` when none exists, which is
what happens for every user until this feature ships). You don't need to
touch it; once your HOLD accounts start existing, that field will just
start reporting real numbers with no code change on either side. Worth a
quick message to confirm once you've verified a HELD transfer actually
produces a non-zero `HOLD` balance.

---

## Conventions — unchanged from Round 1

Same idempotency-claim-first shape, CAS not read-check-write, reuse the
`LedgerWriterPort` (now possibly extended per "Touches your existing code"
above — extend it, don't bypass it), `AppError` subclasses only. If you
need a new error, add it to `packages/shared/src/errors.ts` and rebuild
(`npm run build -w packages/shared`).

## Ownership boundaries

**Yours this round**: `apps/api/src/modules/ledger/transfers/**` (extending
your Round 1 sibling work — `transfers.module.ts` now exists, added by
Claude, just use it), a new `.../holds/` or extension of `transfers/` for
the cancel endpoint and sweeper (your call on the split), and
`modules/ledger/core/ledger-writer.{port,service}.ts` **for the one
extension described above** (fine to touch this round — flag it to Claude
if you end up changing `MoveMoneyParams`'s shape in a way that could affect
Codex, though it shouldn't: Codex's track doesn't call `moveMoney`).
**Still not yours**: `apps/api/src/main.ts`, `app.module.ts`,
`modules/auth/**`, `modules/query/**`, `modules/admin/**` (Codex).

## Verifying your work

Set `UNDO_WINDOW_SECONDS=3` and `SWEEPER_INTERVAL_MS=500` in
`apps/api/.env` while testing so you're not waiting 60 real seconds per
run. Extend (or copy the shape of) `scripts/test-antigravity.js`: send
above the threshold, assert `202`+`HELD`+sender already debited+receiver
NOT yet credited; cancel inside the window, assert sender refunded and
conservation holds at every step; let one run through to settle-by-sweeper
instead of cancelling, assert receiver eventually credited; try to cancel
after settlement, assert `409`. Check the three invariant views after every
step, same as Round 1:

```sql
SELECT * FROM ledger.v_conservation;      -- total_paisa must always be 0
SELECT * FROM ledger.v_balance_drift;     -- must always return 0 rows
SELECT * FROM ledger.v_negative_accounts; -- must always return 0 rows
```

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers actually running (the outbox rows
you write are enough — nothing needs to drain them yet), the Centrifugo
bridge, Redis caching, one-payer-many-payees split, load testing, the
simulator itself. Don't build these unless Claude asks.
