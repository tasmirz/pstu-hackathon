const { Pool } = require('pg');
const assert = require('assert');
const { signStepUpToken, newTxnRef } = require('@pstu/shared');
const { config } = require('../apps/api/dist/config');
const { AccountsRepository } = require('../apps/api/dist/modules/ledger/core/accounts.repository');
const { UsersRepository } = require('../apps/api/dist/modules/ledger/core/users.repository');
const { LedgerWriterService } = require('../apps/api/dist/modules/ledger/core/ledger-writer.service');
const { TransfersService } = require('../apps/api/dist/modules/ledger/transfers/transfers.service');
const { RequestsService } = require('../apps/api/dist/modules/ledger/requests/requests.service');
const { BillsService } = require('../apps/api/dist/modules/ledger/bills/bills.service');
const { DisputesService } = require('../apps/api/dist/modules/ledger/disputes/disputes.service');

const adminPool = new Pool({
  connectionString: 'postgres://postgres:postgres@localhost:5432/pstu',
});

const ledgerPool = new Pool({
  connectionString: config.ledgerDatabaseUrl,
});

async function runRound3Tests() {
  console.log('--- Starting Track 2 (Antigravity) Round 3: Reputation Step-Up Verification ---');

  // 1. Setting up test users
  console.log('1. Setting up test users and balances for Round 3...');
  const suffix = Date.now().toString().slice(-6);
  const phoneSender = `+880173${suffix}1`;
  const phoneGood = `+880173${suffix}2`;
  const phoneLowRep = `+880173${suffix}3`;
  const phoneOther = `+880173${suffix}4`;

  const userResSender = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Sender User', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneSender],
  );
  const userResGood = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Good Rep User', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneGood],
  );
  const userResLowRep = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Low Rep User', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneLowRep],
  );
  const userResOther = await adminPool.query(
    `INSERT INTO auth.users (phone, name, pin_hash, status, role) VALUES ($1, 'Other Party', 'hash', 'ACTIVE', 'USER') RETURNING id`,
    [phoneOther],
  );

  const senderId = userResSender.rows[0].id;
  const goodId = userResGood.rows[0].id;
  const lowRepId = userResLowRep.rows[0].id;
  const otherId = userResOther.rows[0].id;

  // Create accounts
  const accResSender = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 5000000) RETURNING id`,
    [senderId],
  );
  const accResGood = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 1000000) RETURNING id`,
    [goodId],
  );
  const accResLowRep = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 1000000) RETURNING id`,
    [lowRepId],
  );
  const accResOther = await adminPool.query(
    `INSERT INTO ledger.accounts (user_id, type, balance) VALUES ($1, 'USER', 1000000) RETURNING id`,
    [otherId],
  );

  // Mint entries
  const mintAccRes = await adminPool.query(`SELECT id FROM ledger.accounts WHERE type = 'SYSTEM_MINT'`);
  const mintAccId = mintAccRes.rows[0].id;
  const totalSeeded = 8000000;

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
     VALUES ($1, $2, $3), ($1, $4, 5000000), ($1, $5, 1000000), ($1, $6, 1000000), ($1, $7, 1000000)`,
    [
      seedTxn.rows[0].id,
      mintAccId,
      -totalSeeded,
      accResSender.rows[0].id,
      accResGood.rows[0].id,
      accResLowRep.rows[0].id,
      accResOther.rows[0].id,
    ],
  );

  // 2. Manufacture low reputation for lowRepId (score < 30)
  // Base 50. 2 REVERSED disputes -> 50 - 2 * 15 = 20 (< 30).
  console.log('2. Manufacturing low reputation (< 30) via reversed disputes for LowRepUser...');
  for (let i = 1; i <= 2; i++) {
    const dispTxn = await adminPool.query(
      `INSERT INTO ledger.transactions (ref, kind, state, sender_id, receiver_id, amount)
       VALUES ($1, 'TRANSFER', 'COMPLETED', $2, $3, 10000) RETURNING id`,
      [newTxnRef(), otherId, lowRepId],
    );
    await adminPool.query(
      `INSERT INTO ledger.disputes (txn_id, raised_by, reason, state, resolved_by, resolution)
       VALUES ($1, $2, 'Dispute ${i}', 'REVERSED', $2, 'Refund approved')`,
      [dispTxn.rows[0].id, otherId],
    );
  }

  // Verify reputation view
  const repCheckGood = await adminPool.query(
    `SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`,
    [goodId],
  );
  const repCheckLow = await adminPool.query(
    `SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`,
    [lowRepId],
  );

  console.log(`   Good User reputation score: ${repCheckGood.rows[0].reputation_score} (expected >= 50)`);
  console.log(`   Low Rep User reputation score: ${repCheckLow.rows[0].reputation_score} (expected <= 20)`);
  assert(repCheckGood.rows[0].reputation_score >= 30, 'Good user must be >= 30');
  assert(repCheckLow.rows[0].reputation_score < 30, 'Low rep user must be < 30');

  // Pre-seed a prior COMPLETED transaction from senderId to lowRepId and goodId
  // so FIRST_TIME_RECIPIENT step-up is already satisfied!
  await adminPool.query(
    `INSERT INTO ledger.transactions (ref, kind, state, sender_id, receiver_id, amount)
     VALUES ($1, 'TRANSFER', 'COMPLETED', $2, $3, 100), ($4, 'TRANSFER', 'COMPLETED', $5, $6, 100)`,
    [newTxnRef(), senderId, lowRepId, newTxnRef(), senderId, goodId],
  );

  const accountsRepo = new AccountsRepository();
  const usersRepo = new UsersRepository(ledgerPool);
  const ledgerWriter = new LedgerWriterService(accountsRepo, usersRepo);
  const transfersService = new TransfersService(ledgerPool, ledgerWriter, accountsRepo, usersRepo);
  const requestsService = new RequestsService(ledgerPool, ledgerWriter, usersRepo);
  const billsService = new BillsService(ledgerPool, ledgerWriter, usersRepo);

  const stepUpTokenSender = signStepUpToken(config.jwtPrivateKey, { sub: senderId, method: 'PIN' });

  // -------------------------------------------------------------
  // Test Section 3: TransfersService LOW_REPUTATION_RECIPIENT
  // -------------------------------------------------------------
  console.log('\n3. Testing TransfersService LOW_REPUTATION_RECIPIENT rule...');

  // 3.1: Transfer to good recipient without step-up -> succeeds (amount ৳100 <= ৳20,000)
  const idemGoodTransfer = `idem-transfer-good-${Date.now()}`;
  const goodTransferRes = await transfersService.transfer({
    senderId,
    toPhone: phoneGood,
    amountPaisa: 10000,
    note: 'To good user',
    idemKey: idemGoodTransfer,
  });
  assert.strictEqual(goodTransferRes.transaction.state, 'COMPLETED');
  console.log('   ✓ Transfer to normal-reputation user without step-up succeeds');

  // 3.2: Transfer to low-reputation recipient without step-up -> 403 STEP_UP_REQUIRED (LOW_REPUTATION_RECIPIENT)
  const idemLowTransfer = `idem-transfer-low-${Date.now()}`;
  try {
    await transfersService.transfer({
      senderId,
      toPhone: phoneLowRep,
      amountPaisa: 10000,
      note: 'To low rep user',
      idemKey: idemLowTransfer,
    });
    assert.fail('Expected STEP_UP_REQUIRED error for low reputation recipient');
  } catch (err) {
    assert.strictEqual(err.code, 'STEP_UP_REQUIRED');
    assert.strictEqual(err.details.reason, 'LOW_REPUTATION_RECIPIENT');
    console.log('   ✓ Transfer to low-reputation user without step-up throws STEP_UP_REQUIRED with reason LOW_REPUTATION_RECIPIENT');
  }

  // 3.3: Retry transfer to low-reputation recipient WITH step-up -> succeeds
  const lowTransferRes = await transfersService.transfer({
    senderId,
    toPhone: phoneLowRep,
    amountPaisa: 10000,
    note: 'To low rep user with step-up',
    idemKey: idemLowTransfer,
    stepUpToken: stepUpTokenSender,
  });
  assert.strictEqual(lowTransferRes.transaction.state, 'COMPLETED');
  console.log('   ✓ Retry transfer with valid step-up token succeeds');

  // -------------------------------------------------------------
  // Test Section 4: RequestsService LOW_REPUTATION_RECIPIENT
  // -------------------------------------------------------------
  console.log('\n4. Testing RequestsService LOW_REPUTATION_RECIPIENT rule on pay()...');

  // 4.1: LowRepUser creates money request to sender
  const reqRes = await requestsService.create(
    lowRepId,
    phoneSender,
    25000,
    'Pay me please',
  );

  // 4.2: Sender pays request without step-up -> 403 STEP_UP_REQUIRED (LOW_REPUTATION_RECIPIENT)
  const idemReqPay = `idem-req-pay-${Date.now()}`;
  try {
    await requestsService.pay({
      payerId: senderId,
      requestId: reqRes.id,
      idemKey: idemReqPay,
    });
    assert.fail('Expected STEP_UP_REQUIRED on paying request to low reputation recipient');
  } catch (err) {
    assert.strictEqual(err.code, 'STEP_UP_REQUIRED');
    assert.strictEqual(err.details.reason, 'LOW_REPUTATION_RECIPIENT');
    console.log('   ✓ Paying request to low-reputation requester without step-up throws STEP_UP_REQUIRED (LOW_REPUTATION_RECIPIENT)');
  }

  // 4.3: Sender pays request WITH step-up -> succeeds
  const reqPayRes = await requestsService.pay({
    payerId: senderId,
    requestId: reqRes.id,
    idemKey: idemReqPay,
    stepUpToken: stepUpTokenSender,
  });
  assert.strictEqual(reqPayRes.transaction.kind, 'REQUEST_SETTLE');
  console.log('   ✓ Paying request to low-reputation requester with step-up token succeeds');

  // -------------------------------------------------------------
  // Test Section 5: BillsService LOW_REPUTATION_RECIPIENT
  // -------------------------------------------------------------
  console.log('\n5. Testing BillsService LOW_REPUTATION_RECIPIENT rule on pay()...');

  // 5.1: LowRepUser creates shared bill involving Sender and Other
  const billRes = await billsService.create(
    lowRepId,
    'Dinner bill',
    [
      { phone: phoneSender, amount_paisa: 30000 },
      { phone: phoneOther, amount_paisa: 30000 },
    ],
  );

  // 5.2: Sender pays bill share without step-up -> 403 STEP_UP_REQUIRED (LOW_REPUTATION_RECIPIENT)
  const idemBillPay = `idem-bill-pay-${Date.now()}`;
  try {
    await billsService.pay({
      payerId: senderId,
      billId: billRes.id,
      idemKey: idemBillPay,
    });
    assert.fail('Expected STEP_UP_REQUIRED on paying bill to low reputation creator');
  } catch (err) {
    assert.strictEqual(err.code, 'STEP_UP_REQUIRED');
    assert.strictEqual(err.details.reason, 'LOW_REPUTATION_RECIPIENT');
    console.log('   ✓ Paying bill share to low-reputation bill creator without step-up throws STEP_UP_REQUIRED (LOW_REPUTATION_RECIPIENT)');
  }

  // 5.3: Sender pays bill share WITH step-up -> succeeds
  const billPayRes = await billsService.pay({
    payerId: senderId,
    billId: billRes.id,
    idemKey: idemBillPay,
    stepUpToken: stepUpTokenSender,
  });
  assert.strictEqual(billPayRes.transaction.kind, 'BILL_SHARE_SETTLE');
  console.log('   ✓ Paying bill share to low-reputation bill creator with step-up token succeeds');

  // -------------------------------------------------------------
  // Test Section 6: Invariant Views Verification
  // -------------------------------------------------------------
  console.log('\n6. Verifying Ledger Conservation & Invariants after Round 3...');

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

  console.log('\n=== ALL ROUND 3 (REPUTATION STEP-UP) TESTS PASSED PERFECTLY ===\n');

  await adminPool.end();
  await ledgerPool.end();
}

runRound3Tests().catch((err) => {
  console.error('Round 3 Test execution failed:', err);
  process.exit(1);
});
