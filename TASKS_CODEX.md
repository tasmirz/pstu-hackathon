# Assignment: Codex — Round 2: Expose Reputation in Query + Admin

## Round 1 — done, verified, thank you

Bootstrap (`main.ts`/`app.module.ts`), `AuthModule`, `QueryModule`,
`AdminModule` (incl. wiring Antigravity's `AdminDisputesController`) all
landed and were verified live by Claude: register (real signup-bonus
ledger txn) → login → balance → lookup → step-up → transfer → promote to
admin → `GET /admin/integrity` all `pass:true`, `403` for non-admin. The
whole app boots and every route maps correctly. Nothing in this round asks
you to revisit that work.

---

## The feature: Reputation

A new **read-only, derived** trust score per user — never a mutable
column, nothing to keep in sync, nothing to write-lock. Claude already
built the SQL: `ledger.v_user_reputation`
(`infra/sql/005_reputation_claude.sql`, already applied), computed from
completed transaction count, account age, disputes the user was party to
that resolved `REVERSED`, and current `FROZEN` status. Score is `0`–`100`.
Full contract, including the honest limitation about not being able to
determine fault in a dispute, is in `API.md` under **"Reputation"** — read
that section before writing anything, it's short.

```sql
SELECT user_id, status, account_age_days, completed_txn_count,
       disputes_reversed_involving, disputes_raised, reputation_score
  FROM ledger.v_user_reputation
 WHERE user_id = $1;
```

Granted to `read_svc` already — your `QueryModule`'s pool can select it
today with no further migration.

## What to build

### 1. `GET /users/lookup?phone=` — add the `reputation` field

In `apps/api/src/modules/query/query.service.ts`'s `lookupUser`, join (or
follow with a second query against) `ledger.v_user_reputation` for the
resolved user and add to the response:
```jsonc
{ "id": 43, "name": "Karim U.", "phone": "...", "is_first_time": true,
  "reputation": { "score": 62, "tier": "GOOD" } }
```
Tier mapping (put this in one small helper, e.g. `reputationTier(score:
number): 'EXCELLENT'|'GOOD'|'FAIR'|'LOW'` — a judge may ask why the
boundaries are where they are, keep it a single readable function, not
inlined):

| Tier | Score |
|---|---|
| `EXCELLENT` | ≥ 80 |
| `GOOD` | 60–79 |
| `FAIR` | 40–59 |
| `LOW` | < 40 |

### 2. (P2, only if ahead) `GET /admin/users/:id/reputation`

A small admin-facing endpoint returning the full row from
`ledger.v_user_reputation` (not just score/tier — the breakdown is useful
for an admin deciding whether to freeze someone or resolve a dispute).
Guard with `AdminGuard`, no step-up needed (it's a read). Not required —
the lookup endpoint above is the one thing another agent (DeepSeek, doing
UI) is waiting on.

## What you don't need to do

**The step-up enforcement itself (`LOW_REPUTATION_RECIPIENT`, blocking a
transfer to a `score < 30` recipient) is Antigravity's job**, not yours —
it lives in the ledger write path (`TransfersService`), which is their
file. You're only exposing the *read* of the score; don't add any
transfer-blocking logic in `QueryModule`.

## Ownership boundaries

**Yours**: `apps/api/src/modules/query/**` (unchanged from Round 1),
optionally a new `apps/api/src/modules/admin/admin-reputation.controller.ts`
if you build the P2 item — register it in the existing `AdminModule`
you already own. **Not yours**: `modules/ledger/**` (Antigravity),
`infra/sql/005_reputation_claude.sql` (already written and applied by
Claude — don't re-migrate it).

## Verifying your work

```bash
curl -G "http://localhost:3000/users/lookup" --data-urlencode "phone=+8801711110002" \
  -H "Authorization: Bearer $TOKEN"
```
should now include `reputation: { score, tier }`. Cross-check the number
against `SELECT * FROM ledger.v_user_reputation WHERE user_id = <id>`
directly — they must agree exactly (you're reading the view, not
recomputing the formula).

## Explicitly out of scope

TOTP, the Kafka outbox relay/consumers, the Centrifugo bridge, Redis
caching, one-payer-many-payees split, load testing, the simulator. Don't
build these unless Claude asks.
