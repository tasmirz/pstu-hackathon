# Build Log — DeepSeek (UI design / Stitch)

Running log of UI design work done by DeepSeek (agent "deepseek"). Newest entry
on top. This agent's track is **UI mocks in Stitch + `UI_SPEC.md`** — it does
not touch backend code (`apps/api/**`), frontend React code, or infra. Backend
tracks belong to Codex (`TASKS_CODEX.md`) and Antigravity
(`TASKS_ANTIGRAVITY.md`); master coordination lives in `TASKS_CLAUDE.md`.

**Stitch project:** "Ledger Flow Money Movement", id `12103859305734439630`,
design system "Kinetic Ledger" (`assets/da43ec6052af406ab60038e603948426`).

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