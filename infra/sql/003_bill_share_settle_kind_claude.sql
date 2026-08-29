-- Adds the BILL_SHARE_SETTLE transaction kind (Shared Bill Payment feature,
-- see infra/sql/002_bills_and_role_claude.sql and TASKS_CLAUDE.md §3 Track 2).
ALTER TABLE ledger.transactions DROP CONSTRAINT IF EXISTS txn_kind_chk;
ALTER TABLE ledger.transactions ADD CONSTRAINT txn_kind_chk CHECK (kind IN (
  'SIGNUP_BONUS', 'TRANSFER', 'REQUEST_SETTLE', 'SPLIT',
  'HOLD_SETTLE', 'HOLD_CANCEL', 'REVERSAL', 'REFUND',
  'ESCROW_PLACE', 'ESCROW_CLAIM', 'ESCROW_REFUND',
  'BILL_SHARE_SETTLE'));
