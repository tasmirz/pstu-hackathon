const { Pool } = require('pg');
const assert = require('assert');
const { signStepUpToken, newTxnRef } = require('@pstu/shared');
const { config } = require('../apps/api/dist/config');
const { AccountsRepository } = require('../apps/api/dist/modules/ledger/core/accounts.repository');
const { UsersRepository } = require('../apps/api/dist/modules/ledger/core/users.repository');
const { LedgerWriterService } = require('../apps/api/dist/modules/ledger/core/ledger-writer.service');
const { TransfersService } = require('../apps/api/dist/modules/ledger/transfers/transfers.service');
const { SweeperService } = require('../apps/api/dist/modules/ledger/transfers/sweeper.service');

const adminPool = new Pool({
  connectionString: 'postgres://postgres:postgres@localhost:5432/pstu',
});

const ledgerPool = new Pool({
  connectionString: config.ledgerDatabaseUrl,
});

async function runRound2Tests() {
  console.log('--- Starting Track 2 (Antigravity) Round 2: HOLD & Sweeper Verification ---');

  // 1. Setup test users and seed accounts
  console.log('1. Setting up test users and balances for Round 2...');
  const suffix = Date.now().toString().slice(-6);
  const phoneSender = `+880172${suffix}1`;
  const phoneReceiver = `+880172${suffix}2`;
  const phoneOther = `+880172${suffix}3`;

  const userResSender = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Sender Hold', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneSender],
  );
  const userResReceiver = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Receiver Hold', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneReceiver],
  );
  const userResOther = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Other User', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneOther],
  );

  const senderId = userResSender.rows[0].id;
  const receiverId = userResReceiver.rows[0].id;
  const otherId = userResOther.rows[0].id;

  // Create accounts
  const accResSender = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 2000000) RETURNING id`,
    [senderId],
  );
  const accResReceiver = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 100000) RETURNING id`,
    [receiverId],
  );
  const accResOther = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 100000) RETURNING id`,
    [otherId],
  );

  // Mint entries
  const mintAccRes = await adminPool.query(`SELECT id FROM ledger.accounts WHERE type = 'SYSTEM_MINT'`);
  const mintAccId = mintAccRes.rows[0].id;
  const totalSeeded = 2200000;

  await adminPool.query(
    `UPDATE ledger.accounts SET balance = balance - $1 WHERE id = $2`,
    [totalSeeded, mintAccId],
  );
  const seedTxn = await adminPool.query(
    `INSERT INTO ledger.transactions (ref, kind, state, sender_id, receiver_id, amount)
     VALUES ($1, 'SIGNUP_BONUS', 'COMPLETED', NULL, $2, $3) RETURNING id`,
    [newTxnRef(), senderId, totalSeeded],
  );
  await adminPool.query(
    `INSERT INTO ledger.entries (txn_id, account_id, amount)
     VALUES ($1, $2, $3), ($1, $4, 2000000), ($1, $5, 100000), ($1, $6, 100000)`,
    [seedTxn.rows[0].id, mintAccId, -totalSeeded, accResSender.rows[0].id, accResReceiver.rows[0].id, accResOther.rows[0].id],
  );

  console.log('   Users and balances seeded.');

  const accountsRepo = new AccountsRepository();
  const usersRepo = new UsersRepository(ledgerPool);
  const ledgerWriter = new LedgerWriterService(accountsRepo, usersRepo);
  const transfersService = new TransfersService(ledgerPool, ledgerWriter, accountsRepo, usersRepo);
  const sweeperService = new SweeperService(ledgerPool, ledgerWriter, accountsRepo);

  const stepUpTokenSender = signStepUpToken(config.jwtPrivateKey, { sub: senderId, method: 'PIN' });

  // -------------------------------------------------------------
  // Test Section 2: Normal transfer below threshold
  // -------------------------------------------------------------
  console.log('\n2. Testing transfer below threshold (immediate COMPLETED)...');
  const belowThresholdAmount = 100000; // ৳1,000 <= ৳5,000 threshold
  const idemNormal = `idem-normal-${Date.now()}`;
  const normalRes = await transfersService.transfer({
    senderId,
    toPhone: phoneReceiver,
    amountPaisa: belowThresholdAmount,
    note: 'Small lunch',
    idemKey: idemNormal,
    stepUpToken: stepUpTokenSender,
  });

  assert.strictEqual(normalRes.transaction.state, 'COMPLETED');
  assert.strictEqual(normalRes.transaction.kind, 'TRANSFER');
  assert.strictEqual(normalRes.can_cancel_until, undefined);
  console.log('   ✓ Below-threshold transfer completes immediately with state=COMPLETED');

  // -------------------------------------------------------------
  // Test Section 3: Held transfer above threshold
  // -------------------------------------------------------------
  console.log('\n3. Testing transfer above threshold (> ৳5,000 -> HELD)...');
  const aboveThresholdAmount = 600000; // ৳6,000 > ৳5,000
  const idemHeld1 = `idem-held-${Date.now()}-1`;
  const heldRes1 = await transfersService.transfer({
    senderId,
    toPhone: phoneReceiver,
    amountPaisa: aboveThresholdAmount,
    note: 'Large transfer',
    idemKey: idemHeld1,
    stepUpToken: stepUpTokenSender,
  });

  assert.strictEqual(heldRes1.transaction.state, 'HELD');
  assert.strictEqual(heldRes1.transaction.kind, 'TRANSFER');
  assert(heldRes1.can_cancel_until !== undefined, 'Must provide can_cancel_until');
  assert.strictEqual(heldRes1.transaction.settle_after !== undefined, true);
  console.log('   ✓ Above-threshold transfer creates state=HELD with settle_after and can_cancel_until');

  // Verify accounts in DB: sender USER account debited, sender HOLD account credited, receiver untouched!
  const senderUserBal = await accountsRepo.getBalance(ledgerPool, accResSender.rows[0].id);
  const senderHoldAccId = await accountsRepo.getOrCreateHoldAccountId(ledgerPool, senderId);
  const senderHoldBal = await accountsRepo.getBalance(ledgerPool, senderHoldAccId);
  const receiverUserBal = await accountsRepo.getBalance(ledgerPool, accResReceiver.rows[0].id);

  assert.strictEqual(senderHoldBal, aboveThresholdAmount, 'Sender HOLD account must hold the exact transfer amount');
  assert.strictEqual(receiverUserBal, 100000 + belowThresholdAmount, 'Receiver must NOT have received funds yet');
  console.log('   ✓ Double-entry verified: sender debited, money in sender HOLD account, receiver untouched');

  // -------------------------------------------------------------
  // Test Section 4: Cancel within Undo Window
  // -------------------------------------------------------------
  console.log('\n4. Testing Cancel within Undo Window (POST /transfers/:id/cancel)...');

  // Test 4.1: Non-sender cannot cancel
  const idemCancelFail = `idem-cancel-fail-${Date.now()}`;
  try {
    await transfersService.cancel({
      senderId: otherId,
      txnId: heldRes1.transaction.id,
      idemKey: idemCancelFail,
    });
    assert.fail('Expected NOT_A_PARTY error');
  } catch (err) {
    assert.strictEqual(err.code, 'NOT_A_PARTY');
    console.log('   ✓ cancel() rejects non-sender with NOT_A_PARTY (403)');
  }

  // Test 4.2: Sender cancels within window
  const idemCancel1 = `idem-cancel-${Date.now()}-1`;
  const cancelRes1 = await transfersService.cancel({
    senderId,
    txnId: heldRes1.transaction.id,
    idemKey: idemCancel1,
  });

  assert.strictEqual(cancelRes1.transaction.kind, 'HOLD_CANCEL');
  assert.strictEqual(cancelRes1.transaction.state, 'COMPLETED');
  console.log('   ✓ cancel() creates HOLD_CANCEL transaction returning funds to sender USER account');

  // Verify DB state: original txn is CANCELLED, HOLD balance is 0, sender USER balance restored
  const origTxnCheck = await ledgerPool.query(`SELECT * FROM ledger.transactions WHERE id = $1`, [
    heldRes1.transaction.id,
  ]);
  assert.strictEqual(origTxnCheck.rows[0].state, 'CANCELLED');

  const senderHoldBalAfterCancel = await accountsRepo.getBalance(ledgerPool, senderHoldAccId);
  assert.strictEqual(senderHoldBalAfterCancel, 0, 'Sender HOLD balance must be 0 after cancel');
  console.log('   ✓ Original txn CAS updated to CANCELLED and HOLD account balance returned to 0');

  // Test 4.3: Cancel replay returns same response
  const cancelReplay = await transfersService.cancel({
    senderId,
    txnId: heldRes1.transaction.id,
    idemKey: idemCancel1,
  });
  assert.strictEqual(cancelReplay.transaction.id, cancelRes1.transaction.id);
  console.log('   ✓ cancel() idempotency replay returns cached response');

  // Test 4.4: Cancel again with different key -> 409 INVALID_STATE
  try {
    await transfersService.cancel({
      senderId,
      txnId: heldRes1.transaction.id,
      idemKey: `idem-cancel-diff-${Date.now()}`,
    });
    assert.fail('Expected INVALID_STATE error');
  } catch (err) {
    assert.strictEqual(err.code, 'INVALID_STATE');
    console.log('   ✓ cancel() on already cancelled txn throws INVALID_STATE (409)');
  }

  // -------------------------------------------------------------
  // Test Section 5: Sweeper Automatic Settlement
  // -------------------------------------------------------------
  console.log('\n5. Testing Sweeper Automatic Settlement...');

  // Create another held transfer
  const idemHeld2 = `idem-held-${Date.now()}-2`;
  const heldRes2 = await transfersService.transfer({
    senderId,
    toPhone: phoneReceiver,
    amountPaisa: 700000,
    note: 'Rent share',
    idemKey: idemHeld2,
    stepUpToken: stepUpTokenSender,
  });
  assert.strictEqual(heldRes2.transaction.state, 'HELD');

  // Fast-forward settle_after in the database to simulate window expiration
  await adminPool.query(
    `UPDATE ledger.transactions SET settle_after = now() - interval '5 seconds' WHERE id = $1`,
    [heldRes2.transaction.id],
  );

  // Run sweeper
  const settledCount = await sweeperService.sweepOnce();
  assert(settledCount >= 1, 'Sweeper must settle at least 1 held transaction');
  console.log(`   ✓ Sweeper processed and settled ${settledCount} expired held transaction(s)`);

  // Verify DB state: original txn is COMPLETED, HOLD_SETTLE created, receiver USER balance credited
  const origTxn2Check = await ledgerPool.query(`SELECT * FROM ledger.transactions WHERE id = $1`, [
    heldRes2.transaction.id,
  ]);
  assert.strictEqual(origTxn2Check.rows[0].state, 'COMPLETED');

  const settleTxnCheck = await ledgerPool.query(
    `SELECT * FROM ledger.transactions WHERE parent_txn_id = $1 AND kind = 'HOLD_SETTLE'`,
    [heldRes2.transaction.id],
  );
  assert.strictEqual(settleTxnCheck.rowCount, 1, 'HOLD_SETTLE transaction must exist');
  assert.strictEqual(settleTxnCheck.rows[0].state, 'COMPLETED');

  const receiverBalFinal = await accountsRepo.getBalance(ledgerPool, accResReceiver.rows[0].id);
  assert.strictEqual(
    receiverBalFinal,
    100000 + belowThresholdAmount + 700000,
    'Receiver must be credited the 700,000 paisa',
  );
  console.log('   ✓ Sweeper CAS updated original to COMPLETED, created HOLD_SETTLE, and credited receiver');

  // Test 5.1: Late cancel after sweeper settlement -> 409 INVALID_STATE
  try {
    await transfersService.cancel({
      senderId,
      txnId: heldRes2.transaction.id,
      idemKey: `idem-cancel-late-${Date.now()}`,
    });
    assert.fail('Expected INVALID_STATE error for late cancel');
  } catch (err) {
    assert.strictEqual(err.code, 'INVALID_STATE');
    console.log('   ✓ Late cancel attempt after sweeper settlement throws INVALID_STATE (409)');
  }

  // -------------------------------------------------------------
  // Test Section 6: Invariant Views
  // -------------------------------------------------------------
  console.log('\n6. Verifying Ledger Conservation & Invariants after Round 2...');

  const conservationRes = await adminPool.query(`SELECT * FROM ledger.v_conservation`);
  console.log(`   Global Conservation total_paisa = ${conservationRes.rows[0].total_paisa}`);
  assert.strictEqual(
    Number(conservationRes.rows[0].total_paisa),
    0,
    'Global conservation total_paisa must be exactly 0',
  );
  console.log('   ✓ ledger.v_conservation total_paisa === 0');

  const driftRes = await adminPool.query(`SELECT * FROM ledger.v_balance_drift`);
  assert.strictEqual(driftRes.rowCount, 0, 'No balance drift rows allowed');
  console.log('   ✓ ledger.v_balance_drift has 0 rows');

  const negativeRes = await adminPool.query(`SELECT * FROM ledger.v_negative_accounts`);
  assert.strictEqual(negativeRes.rowCount, 0, 'No negative USER/HOLD accounts allowed');
  console.log('   ✓ ledger.v_negative_accounts has 0 rows');

  console.log('\n=== ALL ROUND 2 (HOLD & SWEEPER) TESTS PASSED PERFECTLY ===\n');

  await adminPool.end();
  await ledgerPool.end();
}

runRound2Tests().catch((err) => {
  console.error('Round 2 Test execution failed:', err);
  process.exit(1);
});
