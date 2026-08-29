# Build Log — Antigravity

Running log of backend implementation work done by Antigravity. Newest entry on top.

---

## 2026-08-29 — Round 2: HOLD / 60-Second Undo Window & Sweeper Service (Completed)

Implemented PLAN.md §4.2 / TASKS_ANTIGRAVITY.md Round 2:
1. **Threshold Branch in `TransfersService`**:
   - Transfers above threshold (`config.undoThresholdPaisa`, ৳5,000 = `500000` paisa) land in `state='HELD'`.
   - Sender is debited immediately; money lands in the sender's own `HOLD` account (`AccountsRepository.getOrCreateHoldAccountId`).
   - `settle_after` timestamp set to `now() + undoWindowSeconds`.
   - Dispatches `txn.held` outbox event.
   - Returns `202 Accepted` response with `can_cancel_until` and `settle_after`.
2. **Idempotent Cancel Endpoint (`POST /transfers/:id/cancel`)**:
   - Guarded on `JwtAuthGuard`.
   - CAS transitions the original transaction `HELD -> CANCELLED`.
   - Creates a balanced `HOLD_CANCEL` compensating transaction (`parent_txn_id = original.id`) returning funds from `sender.HOLD` back to `sender.USER`.
   - Returns `{ transaction, balance_paisa }`.
3. **Automated Background `SweeperService`**:
   - Queries `SELECT id FROM ledger.transactions WHERE state = 'HELD' AND settle_after <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100`.
   - In individual transactions, CAS transitions `HELD -> COMPLETED`.
   - Creates a balanced `HOLD_SETTLE` transaction (`parent_txn_id = original.id`) moving funds from `sender.HOLD` to `receiver.USER`.
   - Dispatches `txn.completed` outbox event.
   - Lifecycle managed via `OnModuleInit` and `OnModuleDestroy`.
4. **Core Ledger Writer Extension**:
   - Extended `MoveMoneyParams` with optional `senderAccountId`, `receiverAccountId`, `state`, `settleAfter`, and `outboxTopic` overrides.
   - Preserves single double-entry source of truth in `LedgerWriterService` without code duplication.
5. **Verification**:
   - Automated tests in `scripts/test-antigravity-round2.js` pass with 100% success.
   - Verified that late cancel after sweeper settlement returns `409 INVALID_STATE`.
   - Invariant views verified: `v_conservation = 0`, `v_balance_drift = 0`, `v_negative_accounts = 0`.

---

## 2026-08-29 — Round 1: Disputes, Bill Payment (1:1), and Shared Bill Payment (Completed)

Completed and verified all Phase 1 deliverables:
1. **Disputes Module** (`modules/ledger/disputes/` and `modules/admin/admin-disputes.controller.ts`):
   - `POST /disputes`: Raises dispute, catches Postgres unique index constraint `23505` to return `409 DISPUTE_ALREADY_OPEN` atomically.
   - `GET /disputes`: Lists user's raised disputes.
   - `GET /admin/disputes`: Admin queue with keyset pagination and read-time advisory `reversible_now`.
   - `POST /admin/disputes/:id/resolve`: Handles `REJECT` and `REVERSE` with structured `ledger.audit_log` logging.
   - **Two-phase error handling (§4.3)**: When a reversal fails due to `INSUFFICIENT_FUNDS` (402), the transaction rolls back, dispute remains genuinely `OPEN`, and failure attempt (`attempts + 1`, `last_attempt_at`, `last_attempt_error`) is recorded in a separate non-transactional query before re-throwing 402 to the admin.
2. **Bill Payment (1:1) / Money Requests** (`modules/ledger/requests/`):
   - `POST /money-requests`: 24-hour expiration, no money moved on create.
   - `POST /money-requests/:id/pay`: Double-entry money settlement via `LedgerWriterPort.moveMoney` (`kind: 'REQUEST_SETTLE'`), step-up authentication, CAS to `PAID`.
   - `decline`, `cancel`, and `remind` (with 1-hour rate limit).
3. **Multi-User Shared Bill Payment** (`modules/ledger/bills/`):
   - `POST /bills`: Validates $\ge 2$ shares, unique phones, computes server-side total amount, atomically inserts bill and bill shares.
   - `POST /bills/:id/pay`: Settles individual share (`kind: 'BILL_SHARE_SETTLE'`), CAS share to `PAID`, automatically transitions bill `OPEN -> SETTLED` when all shares are paid.
   - `GET /bills/mine`, `GET /bills/:id`, `POST /bills/:id/cancel`.
4. **Verification**:
   - `scripts/test-antigravity.js` passes 100% of test cases.
   - Global conservation (`v_conservation = 0`), zero balance drift (`v_balance_drift = 0`), zero negative accounts (`v_negative_accounts = 0`).
