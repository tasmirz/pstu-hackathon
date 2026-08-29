const { Pool } = require('pg');
const assert = require('assert');
const { signStepUpToken, newTxnRef } = require('@pstu/shared');
const { config } = require('../apps/api/dist/config');
const { AccountsRepository } = require('../apps/api/dist/modules/ledger/core/accounts.repository');
const { UsersRepository } = require('../apps/api/dist/modules/ledger/core/users.repository');
const { LedgerWriterService } = require('../apps/api/dist/modules/ledger/core/ledger-writer.service');
const { ReversalCoreService } = require('../apps/api/dist/modules/ledger/core/reversal-core.service');
const { DisputesService } = require('../apps/api/dist/modules/ledger/disputes/disputes.service');
const { RequestsService } = require('../apps/api/dist/modules/ledger/requests/requests.service');
const { BillsService } = require('../apps/api/dist/modules/ledger/bills/bills.service');

const adminPool = new Pool({
  connectionString: 'postgres://postgres:postgres@localhost:5432/pstu',
});

const ledgerPool = new Pool({
  connectionString: config.ledgerDatabaseUrl,
});

async function runTests() {
  console.log('--- Starting Track 2 (Antigravity) Automated Verification ---');

  // 1. Setup test users and seed accounts
  console.log('1. Setting up test users and balances...');
  const suffix = Date.now().toString().slice(-6);
  const phoneA = `+880171${suffix}1`;
  const phoneB = `+880171${suffix}2`;
  const phoneC = `+880171${suffix}3`;
  const phoneAdmin = `+880171${suffix}9`;

  const userResA = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Alice Test', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneA],
  );
  const userResB = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Bob Test', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneB],
  );
  const userResC = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Charlie Test', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneC],
  );
  const userResAdmin = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Admin Test', 'hash', 'ACTIVE', 'ADMIN') RETURNING id`,
    [phoneAdmin],
  );

  const userA = userResA.rows[0].id;
  const userB = userResB.rows[0].id;
  const userC = userResC.rows[0].id;
  const adminUser = userResAdmin.rows[0].id;

  // Create accounts
  const accResA = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 1000000) RETURNING id`,
    [userA],
  );
  const accResB = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 500000) RETURNING id`,
    [userB],
  );
  const accResC = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 500000) RETURNING id`,
    [userC],
  );
  const accResAdmin = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 100000) RETURNING id`,
    [adminUser],
  );

  // Mint entries to keep ledger balanced
  const mintAccRes = await adminPool.query(`SELECT id FROM ledger.accounts WHERE type = 'SYSTEM_MINT'`);
  const mintAccId = mintAccRes.rows[0].id;
  const totalSeeded = 2100000;

  await adminPool.query(
    `UPDATE ledger.accounts SET balance = balance - $1 WHERE id = $2`,
    [totalSeeded, mintAccId],
  );
  const seedTxn = await adminPool.query(
    `INSERT INTO ledger.transactions (ref, kind, state, sender_id, receiver_id, amount)
     VALUES ($1, 'SIGNUP_BONUS', 'COMPLETED', NULL, $2, $3) RETURNING id`,
    [newTxnRef(), userA, totalSeeded],
  );
  await adminPool.query(
    `INSERT INTO ledger.entries (txn_id, account_id, amount)
     VALUES ($1, $2, $3), ($1, $4, 1000000), ($1, $5, 500000), ($1, $6, 500000), ($1, $7, 100000)`,
    [seedTxn.rows[0].id, mintAccId, -totalSeeded, accResA.rows[0].id, accResB.rows[0].id, accResC.rows[0].id, accResAdmin.rows[0].id],
  );

  console.log('   Users and balances seeded successfully.');

  // Instantiate services
  const accountsRepo = new AccountsRepository();
  const usersRepo = new UsersRepository(ledgerPool);
  const ledgerWriter = new LedgerWriterService(accountsRepo, usersRepo);
  const reversalCore = new ReversalCoreService(ledgerWriter);

  const disputesService = new DisputesService(ledgerPool, reversalCore);
  const requestsService = new RequestsService(ledgerPool, ledgerWriter, usersRepo);
  const billsService = new BillsService(ledgerPool, ledgerWriter, usersRepo);

  // -------------------------------------------------------------
  // Test Section 2: Money Requests (Bill Payment 1:1)
  // -------------------------------------------------------------
  console.log('\n2. Testing RequestsService (Bill Payment 1:1)...');

  // Test 2.1: SelfTransfer rejected
  try {
    await requestsService.create(userA, phoneA, 10000, 'self');
    assert.fail('Expected SelfTransfer error');
  } catch (err) {
    assert.strictEqual(err.code, 'SELF_TRANSFER');
    console.log('   ✓ create() rejects self-transfer with SELF_TRANSFER (422)');
  }

  // Test 2.2: Create valid money request
  const req1 = await requestsService.create(userA, phoneB, 20000, 'Dinner share');
  assert.strictEqual(req1.state, 'PENDING');
  assert.strictEqual(req1.amount_paisa, 20000);
  assert.strictEqual(req1.payer_id, userB);
  assert.strictEqual(req1.requester_id, userA);
  console.log('   ✓ create() creates PENDING money request');

  // Test 2.3: Pay request with step-up
  const stepUpTokenB = signStepUpToken(config.jwtPrivateKey, { sub: userB, method: 'PIN' });
  const idemPay1 = `idem-pay-${Date.now()}-1`;
  const payRes1 = await requestsService.pay({
    payerId: userB,
    requestId: req1.id,
    idemKey: idemPay1,
    stepUpToken: stepUpTokenB,
  });
  assert.strictEqual(payRes1.transaction.kind, 'REQUEST_SETTLE');
  assert.strictEqual(payRes1.transaction.state, 'COMPLETED');
  console.log('   ✓ pay() executes REQUEST_SETTLE double-entry transaction');

  // Test 2.4: Idempotency replay
  const payRes1Replay = await requestsService.pay({
    payerId: userB,
    requestId: req1.id,
    idemKey: idemPay1,
    stepUpToken: stepUpTokenB,
  });
  assert.strictEqual(payRes1Replay.transaction.id, payRes1.transaction.id);
  console.log('   ✓ pay() idempotency replay returns identical cached response');

  // Test 2.5: Decline request
  const req2 = await requestsService.create(userA, phoneB, 15000, 'Movie');
  const declineRes = await requestsService.decline(userB, req2.id);
  assert.strictEqual(declineRes.state, 'DECLINED');
  console.log('   ✓ decline() transitions PENDING -> DECLINED');

  // Test 2.6: Cancel request
  const req3 = await requestsService.create(userA, phoneB, 12000, 'Snack');
  const cancelRes = await requestsService.cancel(userA, req3.id);
  assert.strictEqual(cancelRes.state, 'CANCELLED');
  console.log('   ✓ cancel() transitions PENDING -> CANCELLED');

  // Test 2.7: Remind request rate limit
  const req4 = await requestsService.create(userA, phoneB, 5000, 'Coffee');
  const remindRes1 = await requestsService.remind(userA, req4.id);
  assert.strictEqual(remindRes1.reminded, true);
  try {
    await requestsService.remind(userA, req4.id);
    assert.fail('Expected rate limit error');
  } catch (err) {
    assert.strictEqual(err.code, 'VELOCITY_EXCEEDED');
    console.log('   ✓ remind() enforces 1-hour rate limit with VELOCITY_EXCEEDED');
  }

  // -------------------------------------------------------------
  // Test Section 3: Shared Bill Payment
  // -------------------------------------------------------------
  console.log('\n3. Testing BillsService (Multi-User Shared Bill Payment)...');

  // Test 3.1: Validation failures
  try {
    await billsService.create(userA, 'Trip', [{ phone: phoneB, amount_paisa: 1000 }]);
    assert.fail('Expected validation error for < 2 shares');
  } catch (err) {
    assert.strictEqual(err.code, 'VALIDATION_ERROR');
    console.log('   ✓ create() rejects fewer than 2 shares with VALIDATION_ERROR');
  }

  try {
    await billsService.create(userA, 'Trip', [
      { phone: phoneA, amount_paisa: 1000 },
      { phone: phoneB, amount_paisa: 1000 },
    ]);
    assert.fail('Expected SelfTransfer for creator in shares');
  } catch (err) {
    assert.strictEqual(err.code, 'SELF_TRANSFER');
    console.log('   ✓ create() rejects creator in shares with SELF_TRANSFER (422)');
  }

  // Test 3.2: Create valid bill
  const bill1 = await billsService.create(userA, 'Dinner at Kacchi Bhai', [
    { phone: phoneB, amount_paisa: 25000 },
    { phone: phoneC, amount_paisa: 25000 },
  ]);
  assert.strictEqual(bill1.state, 'OPEN');
  assert.strictEqual(bill1.total_amount_paisa, 50000);
  assert.strictEqual(bill1.shares.length, 2);
  console.log('   ✓ create() creates OPEN bill with calculated total amount and shares');

  // Test 3.3: First share paid
  const idemBillPay1 = `idem-bill-pay-${Date.now()}-1`;
  const billPayRes1 = await billsService.pay({
    payerId: userB,
    billId: bill1.id,
    idemKey: idemBillPay1,
    stepUpToken: stepUpTokenB,
  });
  assert.strictEqual(billPayRes1.transaction.kind, 'BILL_SHARE_SETTLE');
  assert.strictEqual(billPayRes1.bill.state, 'OPEN'); // Still open since User C hasn't paid
  console.log('   ✓ pay() settles 1st share, bill remains OPEN');

  // Test 3.4: Second share paid -> bill automatically SETTLED
  const stepUpTokenC = signStepUpToken(config.jwtPrivateKey, { sub: userC, method: 'PIN' });
  const idemBillPay2 = `idem-bill-pay-${Date.now()}-2`;
  const billPayRes2 = await billsService.pay({
    payerId: userC,
    billId: bill1.id,
    idemKey: idemBillPay2,
    stepUpToken: stepUpTokenC,
  });
  assert.strictEqual(billPayRes2.bill.state, 'SETTLED');
  console.log('   ✓ pay() settles last share, bill transitions automatically to SETTLED');

  // Test 3.5: listMine and getById
  const myCreatedBills = await billsService.listMine(userA, 'created');
  assert(myCreatedBills.items.length >= 1);
  const myOwedBills = await billsService.listMine(userB, 'owed');
  assert(myOwedBills.items.length >= 1);
  const billDetail = await billsService.getById(bill1.id);
  assert.strictEqual(billDetail.state, 'SETTLED');
  assert.strictEqual(billDetail.shares.filter((s) => s.state === 'PAID').length, 2);
  console.log('   ✓ listMine() and getById() return full bill metadata and participant states');

  // Test 3.6: Cancel bill
  const bill2 = await billsService.create(userA, 'Concert', [
    { phone: phoneB, amount_paisa: 10000 },
    { phone: phoneC, amount_paisa: 10000 },
  ]);
  const cancelBillRes = await billsService.cancel(userA, bill2.id);
  assert.strictEqual(cancelBillRes.state, 'CANCELLED');
  console.log('   ✓ cancel() cancels OPEN bill and its pending shares');

  // -------------------------------------------------------------
  // Test Section 4: Disputes Module
  // -------------------------------------------------------------
  console.log('\n4. Testing DisputesService (Dispute Handling & Admin Resolution)...');

  // Create a transfer from User A to User B
  const transferClient = await ledgerPool.connect();
  let transferTxnId;
  try {
    await transferClient.query('BEGIN');
    const transferRes = await ledgerWriter.moveMoney(transferClient, {
      senderId: userA,
      receiverId: userB,
      amountPaisa: 30000,
      kind: 'TRANSFER',
      note: 'Transfer for dispute test',
    });
    await transferClient.query('COMMIT');
    transferTxnId = transferRes.transaction.id;
  } finally {
    transferClient.release();
  }

  // Test 4.1: Non-party dispute attempt
  try {
    await disputesService.raise(userC, transferTxnId, 'Not my transaction');
    assert.fail('Expected NotAParty error');
  } catch (err) {
    assert.strictEqual(err.code, 'NOT_A_PARTY');
    console.log('   ✓ raise() rejects non-party with NOT_A_PARTY (403)');
  }

  // Test 4.2: Valid dispute raise
  const dispute1 = await disputesService.raise(userA, transferTxnId, 'Sent to wrong person');
  assert.strictEqual(dispute1.state, 'OPEN');
  assert.strictEqual(dispute1.txn_id, transferTxnId);
  console.log('   ✓ raise() creates OPEN dispute');

  // Test 4.3: Duplicate dispute on same txn -> DisputeAlreadyOpen (409)
  try {
    await disputesService.raise(userB, transferTxnId, 'Another dispute');
    assert.fail('Expected DisputeAlreadyOpen error');
  } catch (err) {
    assert.strictEqual(err.code, 'DISPUTE_ALREADY_OPEN');
    console.log('   ✓ raise() rejects duplicate dispute with DISPUTE_ALREADY_OPEN (409)');
  }

  // Test 4.4: List mine & Admin queue
  const myDisputes = await disputesService.listMine(userA);
  assert(myDisputes.items.length >= 1);
  const adminQueue = await disputesService.listQueue('OPEN');
  assert(adminQueue.items.length >= 1);
  const queueItem = adminQueue.items.find((i) => i.id === dispute1.id);
  assert.strictEqual(queueItem.reversible_now, true);
  console.log('   ✓ listMine() and listQueue() return advisory reversible_now and queue items');

  // Test 4.5: Admin resolution: REJECT
  const stepUpTokenAdmin = signStepUpToken(config.jwtPrivateKey, { sub: adminUser, method: 'PIN' });
  const idemResolve1 = `idem-resolve-${Date.now()}-1`;
  const resolveRejectRes = await disputesService.resolve({
    adminId: adminUser,
    disputeId: dispute1.id,
    action: 'REJECT',
    resolution: 'Dispute investigated and dismissed.',
    idemKey: idemResolve1,
    stepUpToken: stepUpTokenAdmin,
  });
  assert.strictEqual(resolveRejectRes.dispute.state, 'REJECTED');
  console.log('   ✓ resolve(REJECT) CAS transitions dispute to REJECTED and logs audit');

  // Test 4.6: Admin resolution: REVERSE (successful)
  // Create another transfer User A -> User B
  const transferClient2 = await ledgerPool.connect();
  let transferTxnId2;
  try {
    await transferClient2.query('BEGIN');
    const transferRes2 = await ledgerWriter.moveMoney(transferClient2, {
      senderId: userA,
      receiverId: userB,
      amountPaisa: 15000,
      kind: 'TRANSFER',
      note: 'Transfer 2 for reversal',
    });
    await transferClient2.query('COMMIT');
    transferTxnId2 = transferRes2.transaction.id;
  } finally {
    transferClient2.release();
  }

  const dispute2 = await disputesService.raise(userA, transferTxnId2, 'Mistake transfer');
  const idemResolve2 = `idem-resolve-${Date.now()}-2`;
  const resolveReverseRes = await disputesService.resolve({
    adminId: adminUser,
    disputeId: dispute2.id,
    action: 'REVERSE',
    resolution: 'Verified error, reversing funds.',
    idemKey: idemResolve2,
    stepUpToken: stepUpTokenAdmin,
  });
  assert.strictEqual(resolveReverseRes.dispute.state, 'REVERSED');
  assert.strictEqual(resolveReverseRes.reversal.kind, 'REVERSAL');
  console.log('   ✓ resolve(REVERSE) executes compensating transaction and CAS dispute to REVERSED');

  // Test 4.7: Admin resolution: REVERSE when receiver has insufficient funds (Two-Phase failure handling)
  // Create another transfer User A -> User B
  const transferClient3 = await ledgerPool.connect();
  let transferTxnId3;
  try {
    await transferClient3.query('BEGIN');
    const transferRes3 = await ledgerWriter.moveMoney(transferClient3, {
      senderId: userA,
      receiverId: userB,
      amountPaisa: 50000,
      kind: 'TRANSFER',
      note: 'Transfer 3 for failed reversal',
    });
    await transferClient3.query('COMMIT');
    transferTxnId3 = transferRes3.transaction.id;
  } finally {
    transferClient3.release();
  }

  const dispute3 = await disputesService.raise(userA, transferTxnId3, 'Sent in error');

  // Now drain User B's balance completely to User C so reversal will fail with INSUFFICIENT_FUNDS
  const userBBalRes = await adminPool.query(
    `SELECT balance FROM ledger.accounts WHERE user_id = $1 AND type = 'USER'`,
    [userB],
  );
  const userBBal = userBBalRes.rows[0].balance;
  const drainClient = await ledgerPool.connect();
  try {
    await drainClient.query('BEGIN');
    await ledgerWriter.moveMoney(drainClient, {
      senderId: userB,
      receiverId: userC,
      amountPaisa: userBBal,
      kind: 'TRANSFER',
      note: 'Drain balance',
    });
    await drainClient.query('COMMIT');
  } finally {
    drainClient.release();
  }

  // Attempt resolution (REVERSE) — should fail with InsufficientFunds, dispute stays OPEN, attempts incremented!
  const idemResolve3 = `idem-resolve-${Date.now()}-3`;
  try {
    await disputesService.resolve({
      adminId: adminUser,
      disputeId: dispute3.id,
      action: 'REVERSE',
      resolution: 'Attempting refund',
      idemKey: idemResolve3,
      stepUpToken: stepUpTokenAdmin,
    });
    assert.fail('Expected InsufficientFunds error');
  } catch (err) {
    assert.strictEqual(err.code, 'INSUFFICIENT_FUNDS');
    console.log('   ✓ resolve(REVERSE) throws INSUFFICIENT_FUNDS (402) when receiver has spent funds');
  }

  // Verify dispute in DB is still OPEN and attempts=1
  const dispute3Check = await ledgerPool.query(`SELECT * FROM ledger.disputes WHERE id = $1`, [dispute3.id]);
  const d3Row = dispute3Check.rows[0];
  assert.strictEqual(d3Row.state, 'OPEN', 'Dispute must remain OPEN');
  assert.strictEqual(d3Row.attempts, 1, 'Attempts counter must be incremented to 1');
  assert(d3Row.last_attempt_error.length > 0, 'Last attempt error must be recorded');
  console.log('   ✓ Two-phase failure verified: dispute remains genuinely OPEN with attempts=1 and last_attempt_error logged');

  // -------------------------------------------------------------
  // Test Section 5: Ledger Invariant Views
  // -------------------------------------------------------------
  console.log('\n5. Verifying Ledger Conservation & Invariants...');

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
  assert.strictEqual(negativeRes.rowCount, 0, 'No negative USER accounts allowed');
  console.log('   ✓ ledger.v_negative_accounts has 0 rows');

  console.log('\n=== ALL ANTIGRAVITY MODULE TESTS PASSED PERFECTLY ===\n');

  await adminPool.end();
  await ledgerPool.end();
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
