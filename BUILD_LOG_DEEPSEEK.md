# Build Log — DeepSeek (UI design / Stitch)

Running log of UI design work done by DeepSeek (agent "deepseek"). Newest entry
on top. This agent's track is **UI mocks in Stitch + `UI_SPEC.md`** — it does
not touch backend code (`apps/api/**`), frontend React code, or infra. Backend
tracks belong to Codex (`TASKS_CODEX.md`) and Antigravity
(`TASKS_ANTIGRAVITY.md`); master coordination lives in `TASKS_CLAUDE.md`.

**Stitch project:** "Ledger Flow Money Movement", id `12103859305734439630`,
design system "Kinetic Ledger" (`assets/da43ec6052af406ab60038e603948426`).

---

## 2026-08-29 — Reputation indicator + LOW step-up, frozen banner, REVERSAL row

### What changed

**Stitch** (project `12103859305734439630`) — six screens edited in place, all
confirmed via `get_screen` (title + DOM-op events from each `edit_screens` call):

| Stitch screen | id | Change | UI_SPEC § |
|---|---|---|---|
| Send Money - Step 1 | `c03976b621864e2d92fae08fe5e267aa` | reputation dot + tier label on resolved recipient row | §4 step 1 |
| Send Money - Step 2 (Confirm) | `f0ca9788f9614a0fa861f56abbcc5c9a` | LOW-trust state: `● Low trust` on recipient + unconditional step-up with its own lead-in | §4 step 2 |
| Request Money - Step 1 (create) | `d8b8f390bb8a46c08e1800b4fcb1e242` | reputation dot + `Good` on resolved payer name | §8 create |
| Create a Bill | `d1e44e5cd924436a9e8301dd0e486643` | reputation dot per participant chip (Karim `● Good`, Nadia `● Fair`) | §11 create |
| Dashboard | `fdf0d88655ea46f4974f976d0f8b3b48` | frozen-account banner (`error-container`) + Send visibly disabled, Request stays enabled — state variant, not a new screen | §3 |
| Transaction History | `c636509a89fa4fccb10f166f39f4a78f` | `REVERSAL` row → `Reversed: Sent ৳500 to wrong number` link + `Original: TXN_01J8XKQ4...` mono caption + `+৳500.00` credit | §5 |

**`UI_SPEC.md`** — updated to match:
- §3 / §4 step 1 / §4 step 2 / §5 / §8 create / §11 create each now carry their Stitch screen id.
- New **Reputation** note at §4 step 1 pointing at `API.md` **"Reputation"** (mirrors how §6b/§6c point at the Disputes contract), including the honest-fault-limitation framing — soft trust signal, never an accusation.
- §4 step 2 gained the `LOW_REPUTATION_RECIPIENT` step-up reason (same inline field, new reason).

### Reputation indicator — design decisions worth keeping

- **Compact dot + one-word label**, inline next to the resolved name; the **name stays the dominant element** (same hierarchy principle as the first-name+initial masking decision). `EXCELLENT`/`GOOD` → `#059669` green, `FAIR` → `#b45309` amber, `LOW` → `#ba1a1a` red with label **"Low trust"**. No border, no icon, no badge padding — it must not fight the name for attention.
- Reused verbatim on every screen that resolves a recipient/counterparty from a phone lookup: Send step 1, Request create, and **each** Create-a-Bill participant chip (they're all lookup results).
- LOW step-up on Confirm reuses the existing inline field, only the *reason* changes — the mock shows the lead-in *"This recipient has a low trust score — please verify to continue."* in the same `error-container` alert slot as the duplicate-send warning.
- Frozen state keeps Send **disabled but visible** (`surface-variant`, `cursor-not-allowed`) — a hidden button where one used to be reads as broken on stage.

### ⚠ Concurrent/conflicting activity noticed

- The repo is mid-merge from another agent's backend work (staged changes in
  `apps/api/...`, `sim/run.ts` + `sim/scenarios/idempotency.ts` in conflict). My
  track left those untouched; `UI_SPEC.md` + this build log are the only files I
  changed.
- **Duplicate Transaction History screen** `ae56b83431934f7c82157d2f8ce504bc`
  ("Transaction History - Linked Reversal") was created by a timed-out retry of my
  first Transaction History edit. The canonical screen is `c63650...` (edited in
  place). The `ae56b83...` duplicate cannot be deleted via the Stitch MCP surface
  — **flag for manual cleanup** so the frontend builder doesn't wire the wrong one.
- The concurrent **Request Money - Create** (`d41cc673b30341079b4e68c84942fa63`)
  still exists alongside my canonical **Request Money - Step 1** (`d8b8f390...`,
  which UI_SPEC §8 names as the create screen). I edited `d8b8f...` only — no fork.
  The `d41cc...` screen is still a candidate to reconcile/remove.
- Note: earlier `list_screens`/`get_project` returned a *partial* screen list that
  omitted several screens I built last round (Send Step 3, Inbox/Outbox, My
  Disputes, Limits, Create a Bill, Shared Bill Detail) — those all still exist and
  were confirmed via `get_screen`. Treat the list API as paginated, not exhaustive.

### Verified

- All six screens above confirmed present via `get_screen` (title + id match; each
  `edit_screens` call returned a `project.file_update` DOM-op event for its target
  screen). Post-edit HTML/screenshot download URLs are content-addressed cached
  snapshots and did not refresh, so the DOM-op events are the authoritative record.
- `git diff UI_SPEC.md` reviewed — only `UI_SPEC.md` (+ this build log) modified in
  my track; no backend/frontend/infra files touched.

---

## 2026-08-29 — Money Requests screen + feature-complete screen set for other agents' tracks

### What changed

**Stitch** (project `12103859305734439630`) — new screens generated:

| Stitch screen | id | Covers UI_SPEC § |
|---|---|---|
| Request Money - Step 1 | `d8b8f390bb8a46c08e1800b4fcb1e242` | §8 create |
| Send Money - Step 3 (Result) | `94db528ea4dd4b1a8ccded2717aeca59` | §4 step 3 |
| Money Requests - Inbox & Outbox | `f480e3e7fff841799d07d0a0e8640e96` | §8 inbox/outbox |
| My Disputes | `dbf0fd74c4834b3ebc7157a7cca128de` | §6c |
| Limits & Velocity | `24ae162f64d241e79a95fad3e7afc992` | §10 |
| Create a Bill | `d1e44e5cd924436a9e8301dd0e486643` | §11 create |
| Shared Bill - Detail | `f514a5de96904dbc871ef15f41e33b21` | §11 detail |

**Dashboard edited in-place** (`fdf0d88655ea46f4974f976d0f8b3b48`) — added the
HOLD undo bar (Antigravity Round 2 showpiece): clock icon, `৳10,000.00 to Karim
U. · sending in 47s` (monospace), primary **Undo** link, on a subtle
`surface-container-low` bar.

**`UI_SPEC.md`** — updated to match:
- Screen inventory table now lists the Stitch screen name for every designed screen.
- New §1b "Stitch design reference" — the master screen→spec mapping table for the frontend builder.
- §4 Step 3, §6c, §8 inbox, §9, §10 Limits, §11 create/detail each note the designed Stitch screen.

### Consent-boundary decisions worth keeping

- Request Money create mirrors the Send step-1 layout (recipient phone →
  verified chip, amount, note) plus an info strip: *"Creating a request moves
  no money. Alam sees your request and approves it before any money leaves."*
- Pay routes through the Send confirm screen (UI_SPEC §8 rule) — no second
  settle flow was drawn.
- Expired money requests render greyed with no buttons (they must never be
  silently omitted).

### ⚠️ Concurrent Stitch activity observed (do not duplicate)

While this work ran, three screens appeared in the project that this agent did
**not** create (presumably accepted from the Stitch UI's suggestions):
- **Request Money - Create** (`d41cc673b30341079b4e68c84942fa63`)
- **Money Requests Management** (`21d9addeb1c044baac011740242056f7`)
- **Admin Console & Health Monitor** (`12b91dd9867648f98ece5ea45e362b38`)

If another agent needs a screen that these cover (request create, request
management, admin console), check those before generating a duplicate.

### Screens still not designed (candidates for later tasks)

- Notification feed (P2, §10)
- TOTP enrolment (P2, §10)
- Step-up / PIN inline prompt state on Send confirm
- Duplicate-send guard warning state on Send confirm (§4 step 2)
- Frozen-account banner state on Dashboard (§3)
- Transaction History with a `REVERSAL` row linking to the original (§5)

### Verified

- All screens generated above confirmed present via `get_screen`.
- `git diff UI_SPEC.md` reviewed; only `UI_SPEC.md` is modified in this repo
  (no backend/frontend files touched — safe for Codex/Antigravity to pull).