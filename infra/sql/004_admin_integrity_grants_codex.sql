-- Integrity views are declared after SCHEMA.sql's broad table grants, so they
-- need explicit privileges for the least-privilege ledger application role.
GRANT SELECT ON
  ledger.v_conservation,
  ledger.v_balance_drift,
  ledger.v_negative_accounts
TO txn_svc;
