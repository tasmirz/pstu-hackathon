# Build Log — Antigravity

Running log of backend implementation work done by Antigravity. Newest entry on top.

---

## 2026-08-29 — Round 5: Money Requests Inbox/Outbox (`GET /money-requests/incoming` & `GET /money-requests/outgoing`) (Completed)

Implemented TASKS_ANTIGRAVITY.md Round 5 / API.md "Money Requests":
1. **Inbox & Outbox Endpoints**:
   - `GET /money-requests/incoming?state=&limit=&cursor=`: Lists requests where caller is `payer_id` (money requested from them), with `counterparty` populated as the requester (`id`, `name`, `phone` from `auth.users_public`).
   - `GET /money-requests/outgoing?state=&limit=&cursor=`: Lists requests where caller is `requester_id` (money they requested), with `counterparty` populated as the payer (`id`, `name`, `phone`).
   - Keyset pagination with `cursor` (id < cursor, `ORDER BY id DESC`), `limit` (default 20, max limit + 1 for `has_more` calculation), and optional `state` exact-match filter.
2. **Lazy Expiry Rule**:
   - Sweeps expired pending requests (`UPDATE ledger.money_requests SET state = 'EXPIRED' WHERE state = 'PENDING' AND expires_at <= now() AND (payer_id = $1 OR requester_id = $1)`) so expired requests are returned as `state: 'EXPIRED'` rather than silently omitted, and the underlying DB row state is flipped.
3. **Client & Simulator Scenarios**:
   - Added `incomingRequests` and `outgoingRequests` methods to `sim/harness/client.ts`.
   - Added `REQ-06` (verifying outbox for requester and inbox for payer with full counterparty metadata).
   - Added `REQ-07` (verifying lazy expiry transitions row to `EXPIRED` and presents `state: 'EXPIRED'` across incoming and outgoing).
   - **Verification**: `REQUESTS: 7/7 PASS`, `DISPUTE: 12/12 PASS`, `BILLS: 5/5 PASS` (100% green, conservation held across all scenarios).

---

## 2026-08-29 — Round 4: Simulator Coverage for Disputes, Shared Bills, and Requests (Completed)

Implemented TASKS_ANTIGRAVITY.md Round 4 (HTTP simulator scenario coverage against live NestJS API):
1. **Disputes Simulator Scenarios (`sim/scenarios/disputes.ts` & `sim/scenarios/dispute.ts`)**:
   - `DIS-01`: Raise dispute on completed transfer, admin resolves `REVERSE`, funds reversed to original accounts, `GET /disputes` returns `REVERSED`.
   - `DIS-02`: Admin resolves `REJECT` — no money moves, dispute closes `REJECTED`.
   - `DIS-03`: `409 DISPUTE_ALREADY_OPEN` on second dispute attempt while one is open.
   - `DIS-04`: `403 NOT_A_PARTY` when non-party attempts to dispute a transaction.
   - `DIS-05`: `422 DISPUTE_WINDOW_CLOSED` on transaction older than 7 days.
   - `DIS-06`: Admin `REVERSE` verifies original transaction state flips to `REVERSED` while `REVERSAL` transaction is created.
   - `DIS-07`: Admin `REVERSE` when receiver spent funds returns `402 INSUFFICIENT_FUNDS`, dispute remains `OPEN`, attempt count incremented.
   - `DIS-08`: Admin `REJECT` writes 0 ledger entries.
   - `DIS-09`: Validation error on short resolution text.
   - `DIS-10`: Concurrent admin resolutions — exactly one wins.
   - `DIS-11`: Audit log entry created with JSON before/after state.
   - **Verification**: `11/11 PASS` (100% green, conservation held across all scenarios).

2. **Shared Bills Simulator Scenarios (`sim/scenarios/bills.ts`)**:
   - `BILL-01`: Create 3-share bill, all 3 payers settle individual shares (with step-up challenge handled), bill auto-transitions to `SETTLED` on last share.
   - `BILL-02`: `422 SELF_TRANSFER` when creator's phone is included in shares.
   - `BILL-03`: Non-participant payer rejected with `404 BILL_SHARE_NOT_FOUND`.
   - `BILL-04`: Unstarted bill cancelled successfully; partially paid bill cancellation rejected with `409 INVALID_STATE`.
   - `BILL-05`: Duplicate payment on already-paid share rejected with `409 INVALID_STATE`.
   - **Verification**: `5/5 PASS` (100% green, conservation held across all scenarios).

3. **Money Requests Simulator Scenarios (`sim/scenarios/requests.ts`)**:
   - `REQ-01`: Creating request moves no money and requires no step-up.
   - `REQ-02`: Requester cancels pending request without money movement.
   - `REQ-03`: Payer declines pending request.
   - `REQ-04`: Duplicate payment on settled request returns `409 INVALID_STATE`.
   - `REQ-05`: Rate-limiting enforcement (`429 VELOCITY_EXCEEDED`) on repeated reminders within 1 hour.
   - **Verification**: `5/5 PASS` (100% green, conservation held across all scenarios).

4. **Controller HTTP Status Codes & Fixes**:
   - Explicit `@HttpCode(200)` added to `AdminDisputesController.resolve`, `BillsController.pay`, `BillsController.cancel`, `RequestsController.pay`, `RequestsController.decline`, `RequestsController.cancel`, `RequestsController.remind`, `TransfersController.cancel`.
   - `DisputesService.resolve` populates `details: { dispute_state: 'OPEN', attempts: N }` on `INSUFFICIENT_FUNDS` rollback.
   - `BillsService.cancel` enforces check against already-paid shares before cancellation.
   - `sim/scenarios/happy.ts` accepts `200/201` on request payment.

5. **Invariants Verification**:
   - Ran `npm run sim -w sim -- --tag disputes`, `npm run sim -w sim -- --tag bills`, `npm run sim -w sim -- --tag requests`.
   - Ran `node scripts/test-antigravity.js`, `node scripts/test-antigravity-round2.js`, `node scripts/test-antigravity-round3.js`.
   - Global double-entry conservation held across all runs (`v_conservation = 0`, `v_balance_drift = 0`, `v_negative_accounts = 0`).

---

## 2026-08-29 — Round 3: Reputation Step-Up Enforcement (Completed)

Implemented TASKS_ANTIGRAVITY.md Round 3 / API.md "Reputation":
1. **Rule Enforcement**:
   - Evaluates recipient trust score from `ledger.v_user_reputation` (`reputation_score < config.reputationStepUpThreshold`, default 30).
   - If recipient reputation is below 30, triggers `403 STEP_UP_REQUIRED` with `reason: 'LOW_REPUTATION_RECIPIENT'` regardless of transaction amount.
   - Evaluated transactionally prior to `moveMoney` in:
     - `TransfersService.transfer` (`apps/api/src/modules/ledger/transfers/transfers.service.ts`) against `receiver.id`.
     - `BillsService.pay` (`apps/api/src/modules/ledger/bills/bills.service.ts`) against `bill.created_by`.
     - `RequestsService.pay` (`apps/api/src/modules/ledger/requests/requests.service.ts`) against `reqRow.requester_id`.
2. **Verification**:
   - Created `scripts/test-antigravity-round3.js` manufacturing low reputation scores ($< 30$) via `REVERSED` disputes.
   - Verified that `transfer`, `requestsService.pay`, and `billsService.pay` all reject unauthenticated calls to low-reputation counterparties with `LOW_REPUTATION_RECIPIENT` and succeed upon providing a valid `X-Step-Up-Token`.
   - Verified that transfers to normal-reputation counterparties ($\ge 30$) proceed without requiring low-reputation step-up.
   - Verified ledger invariants: `v_conservation = 0`, `v_balance_drift = 0`, `v_negative_accounts = 0`.

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
