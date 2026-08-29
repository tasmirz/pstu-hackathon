# Assignment: DeepSeek — UI for the 3 selected features with no screens yet

Continue in Stitch project **Ledger Flow Money Movement**
(`12103859305734439630`), design system **Kinetic Ledger**. Keep
backend/frontend code untouched, same as always.

**Context**: Codex found `D:\PSTUHACK\selected_extra_features.md` — the
actual scoring rubric, outside this repo. Their gap analysis,
`EXTRA_FEATURES_AUDIT_AND_DESIGN.md`, is the source of truth for this
round — **read it before starting**, especially the Mermaid flow for each
feature, so the screens you design actually match the states the backend
will produce (Codex is building Institute Bill Payment, Antigravity is
building Dispute recovery + Bill Split completion + a Group Send stretch,
in that priority order — don't wait for all three to land before starting;
design against the documented behavior, same as you've done all session).

## Priority 1 — Dispute recovery status (Antigravity, Round 7)

The one new *state*, not a new screen: when a dispute resolves and the
receiver couldn't cover the full disputed amount, the outcome is a partial
refund plus a `recovery_due` balance on the other party — not the clean
full-refund state your existing **My Disputes** (§6c) screen shows today.
Add this as a state variant:

- On the disputer's side: "Partially refunded — ৳X of ৳Y recovered
  immediately, the remaining ৳Z is being recovered from the other party."
  Honest, not "refund pending" (the secured portion already moved).
- No screen needed for the debtor's `recovery_due` this round unless you
  have time — flag it as backlog if you skip it (a "recovery_due" state on
  someone's own account/dashboard is real but not blocking dispute-side
  clarity).

## Priority 2 — Bill Split: equal split + partial payment (Antigravity, Round 8)

Edit **Create a Bill** (§11 create) to add the split-mode choice
(equal/custom) — equal mode only needs total + participant list, no
per-person amount entry; show the computed per-person split before
confirmation (the remainder-distribution rule means it won't always be
perfectly even — e.g. ৳100/3 → 34/33/33 — show it plainly rather than
implying it's exact division). Edit **Shared Bill Detail** (§11) to show a
per-share progress state (`PARTIALLY_PAID` — a progress indicator or
"৳X of ৳Y paid" rather than only PENDING/PAID as today).

## Priority 3 — Institute Bill Payment (Codex, new feature)

New screens — this doesn't exist in any form yet. Reference audit §4 for
the exact states (`accepted_at <= deadline` is the one rule everything
hangs off). Minimum set:
- A bill list/detail (tuition/hall/exam fee, amount, **deadline
  countdown** — this is the one visual element that matters, since the
  spec's whole point is "does it read clearly whether you made the cutoff")
- A confirmation state distinguishing "accepted before deadline, still
  processing" from "rejected — deadline passed" — these must look
  meaningfully different, not just a color swap, since a student's actual
  money is on one side of that line.

## Priority 4 — Send Money to a Group (Antigravity, stretch — design regardless)

Worth designing even though the backend is a stretch goal for this round —
if the backend doesn't land, at least the screen exists and the story is
tellable. Minimum: a recipient-list entry (bulk-ish, doesn't need to be
1,000 rows — 3-5 rows communicates the concept), a per-recipient outcome
list after submission (success/pending/failed, matching GP-02's mixed-
outcome example from the spec — this is the one visual that makes "we
don't all-or-nothing a batch" legible to a judge in five seconds).

## Backlog — still real, still unclaimed, do if time remains

From the last (unstarted) round, still worth doing in this priority order:
1. **Notification feed** (`UI_SPEC.md` §10) — now has a real backend
   behind it (Antigravity's Round 6, `GET /notifications`) — unread/read
   states, an unread Dashboard indicator, tap-through to the relevant
   transaction/request.
2. **Duplicate-send guard warning** on Send Money confirmation.
3. **Admin simulator presentation** — grouped pass/fail counts, the
   conservation summary, failing scenario IDs as a presentation surface
   (execution is demo/operator-launched, not an API trigger — be honest
   about that in the design).
4. **Canonical-screen cleanup** — the duplicate Transaction History /
   Request Money screens flagged in earlier build log entries; if Stitch
   still can't delete them, mark the canonical IDs explicitly in
   `UI_SPEC.md` so nobody implements the wrong one.

## Deliverables and verification

- Confirm every changed/created screen with `get_screen`.
- Update `UI_SPEC.md` — new numbered sections for Institute Bill Payment
  and Group Send (after §11), state-variant notes on §6c/§11 for the
  other two. Screen ids next to every section you touch, same discipline
  as every prior entry.
- Log in `BUILD_LOG_DEEPSEEK.md` — what changed, screens table, anything
  concurrent/conflicting noticed, what's still undesigned.
- Confirm `git diff` touches only `UI_SPEC.md` + your build log — no
  backend/frontend/sim files, same rule as always.

## Out of scope

TOTP enrolment. Don't touch `apps/api/**`, `frontend/**`, `sim/**`, or
infra.
