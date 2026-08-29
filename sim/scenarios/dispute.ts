import { Scenario } from '../harness/types';

/**
 * DISPUTES — SIMULATOR.md §4, Tier 2. DIS-07 is the one worth writing first:
 * the system refuses to fabricate money, and the failure rolls back across
 * three tables. Admin routes need an ADMIN-role user (JwtAuthGuard reads role
 * fresh per request, so promote-then-use works).
 */

export const DIS_01: Scenario = {
  id: 'DIS-01',
  name: 'Sender raises a dispute: state OPEN, no money moves',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'DIS01');
    const txn = await ctx.transfer(a, b, 150_000);
    const txnId = txn.body.transaction.id;
    const beforeA = await ctx.balance(a);
    const beforeB = await ctx.balance(b);

    const res = await ctx.client.raiseDispute(a.access_token, txnId, 'Sent to the wrong number');
    ctx.expectEq(res.status, 201, 'dispute raised');
    ctx.expectEq(res.body.state, 'OPEN', 'OPEN');
    ctx.expectEq(await ctx.balance(a), beforeA, 'sender balance unchanged');
    ctx.expectEq(await ctx.balance(b), beforeB, 'receiver balance unchanged');
  },
};

export const DIS_02: Scenario = {
  id: 'DIS-02',
  name: 'Receiver may also raise one on the same transaction type',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'DIS02');
    const txn = await ctx.transfer(a, b, 90_000);
    const txnId = txn.body.transaction.id;

    const res = await ctx.client.raiseDispute(b.access_token, txnId, 'Never received service');
    ctx.expectEq(res.status, 201, 'receiver raises dispute');
  },
};

export const DIS_03: Scenario = {
  id: 'DIS-03',
  name: 'Second dispute while one is open: 409 DISPUTE_ALREADY_OPEN',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'DIS03');
    const txn = await ctx.transfer(a, b, 80_000);
    const txnId = txn.body.transaction.id;

    await ctx.client.raiseDispute(a.access_token, txnId, 'first');
    const second = await ctx.client.raiseDispute(a.access_token, txnId, 'again');
    ctx.expectEq(second.status, 409, 'second dispute blocked');
    ctx.expectEq(second.body.error, 'DISPUTE_ALREADY_OPEN', 'DISPUTE_ALREADY_OPEN');
  },
};

export const DIS_04: Scenario = {
  id: 'DIS-04',
  name: 'A non-party raising a dispute: 403 NOT_A_PARTY',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, stranger] = await ctx.freshUsers(3, 'DIS04');
    const txn = await ctx.transfer(a, b, 60_000);
    const txnId = txn.body.transaction.id;

    const res = await ctx.client.raiseDispute(stranger.access_token, txnId, 'none of my business');
    ctx.expectEq(res.status, 403, 'non-party rejected');
    ctx.expectEq(res.body.error, 'NOT_A_PARTY', 'NOT_A_PARTY');
  },
};

export const DIS_05: Scenario = {
  id: 'DIS-05',
  name: 'Transaction older than 7 days: 422 DISPUTE_WINDOW_CLOSED',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'DIS05');
    const txn = await ctx.transfer(a, b, 50_000);
    const txnId = txn.body.transaction.id;

    // Backdate the transaction past the 7-day window.
    await ctx.adminPool.query(
      `UPDATE ledger.transactions SET created_at = now() - interval '8 days' WHERE id = $1`,
      [txnId],
    );
    const res = await ctx.client.raiseDispute(a.access_token, txnId, 'too late');
    ctx.expectEq(res.status, 422, 'window closed');
    ctx.expectEq(res.body.error, 'DISPUTE_WINDOW_CLOSED', 'DISPUTE_WINDOW_CLOSED');
  },
};

export const DIS_06: Scenario = {
  id: 'DIS-06',
  name: 'Admin REVERSE: reversal txn created, original untouched, dispute REVERSED',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS06');
    await ctx.makeAdmin(admin);
    const amount = 200_000;

    const txn = await ctx.transfer(a, b, amount);
    const txnId = txn.body.transaction.id;
    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'wrong number');
    const disputeId = dispute.body.id;

    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    const resolved = await ctx.client.resolveDispute(
      admin.access_token,
      disputeId,
      'REVERSE',
      'Confirmed wrong recipient, funds returned.',
      ctx.uuid(),
      su.body.step_up_token,
    );
    ctx.expectEq(resolved.status, 200, 'admin reversed');
    ctx.expectEq(resolved.body.dispute.state, 'REVERSED', 'dispute REVERSED');
    ctx.expectEq(resolved.body.reversal.kind, 'REVERSAL', 'reversal txn kind');

    const { rows } = await ctx.adminPool.query(`SELECT kind, state, amount FROM ledger.transactions WHERE id = $1`, [txnId]);
    ctx.expectEq(rows[0].kind, 'TRANSFER', 'original kind untouched');
    ctx.expectEq(rows[0].state, 'REVERSED', 'original flipped to REVERSED');
    ctx.expectEq(rows[0].amount, amount, 'original amount unchanged');
  },
};

export const DIS_07: Scenario = {
  id: 'DIS-07',
  name: 'Admin REVERSE when receiver already spent it: 402, dispute stays OPEN, attempts incremented',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, c, admin] = await ctx.freshUsers(4, 'DIS07');
    await ctx.makeAdmin(admin);
    const amount = 300_000;

    // a -> b, dispute, then b drains to c so the reversal cannot be covered.
    const txn = await ctx.transfer(a, b, amount);
    const txnId = txn.body.transaction.id;
    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'wrong number');
    const disputeId = dispute.body.id;

    await ctx.adminPool.query(
      `INSERT INTO ledger.limit_overrides (user_id, daily_send_limit, set_by, reason)
       VALUES ($1, 1000000000, $1, 'simulator: DIS-07 drain') ON CONFLICT (user_id) DO UPDATE SET daily_send_limit = 1000000000`,
      [b.user.id],
    );
    const bBal = await ctx.balance(b);
    await ctx.transfer(b, c, bBal); // b spends everything

    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    const resolved = await ctx.client.resolveDispute(
      admin.access_token,
      disputeId,
      'REVERSE',
      'Attempting refund',
      ctx.uuid(),
      su.body.step_up_token,
    );
    ctx.expectEq(resolved.status, 402, 'reversal fails — receiver spent it');
    ctx.expectEq(resolved.body.error, 'INSUFFICIENT_FUNDS', 'INSUFFICIENT_FUNDS');
    ctx.expectEq(resolved.body.details.dispute_state, 'OPEN', 'dispute stays OPEN');
    ctx.expectEq(resolved.body.details.attempts, 1, 'attempts incremented');

    const { rows } = await ctx.adminPool.query(`SELECT state, attempts FROM ledger.disputes WHERE id = $1`, [disputeId]);
    ctx.expectEq(rows[0].state, 'OPEN', 'DB dispute still OPEN');
    ctx.expectEq(rows[0].attempts, 1, 'DB attempts incremented');
  },
};

export const DIS_08: Scenario = {
  id: 'DIS-08',
  name: 'Admin REJECT: dispute REJECTED, zero entries written',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS08');
    await ctx.makeAdmin(admin);
    const txn = await ctx.transfer(a, b, 100_000);
    const txnId = txn.body.transaction.id;
    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'test');
    const disputeId = dispute.body.id;
    const userIds = [a.user.id, b.user.id, admin.user.id];
    const before = await ctx.adminPool.query(
      `SELECT COUNT(*)::int AS c FROM ledger.entries e
       JOIN ledger.accounts acc ON acc.id = e.account_id
       WHERE acc.user_id = ANY($1::bigint[])`,
      [userIds],
    );
    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    const resolved = await ctx.client.resolveDispute(
      admin.access_token,
      disputeId,
      'REJECT',
      'Recipient confirmed correct.',
      ctx.uuid(),
      su.body.step_up_token,
    );
    ctx.expectEq(resolved.status, 200, 'rejected');
    ctx.expectEq(resolved.body.dispute.state, 'REJECTED', 'REJECTED');
    const after = await ctx.adminPool.query(
      `SELECT COUNT(*)::int AS c FROM ledger.entries e
       JOIN ledger.accounts acc ON acc.id = e.account_id
       WHERE acc.user_id = ANY($1::bigint[])`,
      [userIds],
    );
    ctx.expectEq(after.rows[0].c, before.rows[0].c, 'zero entries written by reject');
  },
};

export const DIS_09: Scenario = {
  id: 'DIS-09',
  name: 'Resolve without resolution text: rejected by the DB constraint',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS09');
    await ctx.makeAdmin(admin);
    const txn = await ctx.transfer(a, b, 70_000);
    const txnId = txn.body.transaction.id;
    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'x');
    const disputeId = dispute.body.id;

    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    const resolved = await ctx.client.resolveDispute(
      admin.access_token,
      disputeId,
      'REJECT',
      'ab', // too short — DTO requires MinLength(3)
      ctx.uuid(),
      su.body.step_up_token,
    );
    ctx.expectEq(resolved.status, 400, 'short resolution rejected by validation');
    void resolved;
  },
};

export const DIS_10: Scenario = {
  id: 'DIS-10',
  name: 'Two admins resolve the same dispute concurrently: exactly one wins',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin1, admin2] = await ctx.freshUsers(4, 'DIS10');
    await ctx.makeAdmin(admin1);
    await ctx.makeAdmin(admin2);
    const txn = await ctx.transfer(a, b, 120_000);
    const txnId = txn.body.transaction.id;
    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'race');
    const disputeId = dispute.body.id;

    const su1 = await ctx.client.stepUp(admin1.access_token, 'PIN', admin1.pin);
    const su2 = await ctx.client.stepUp(admin2.access_token, 'PIN', admin2.pin);
    const results = await Promise.all([
      ctx.client.resolveDispute(admin1.access_token, disputeId, 'REJECT', 'first admin', ctx.uuid(), su1.body.step_up_token),
      ctx.client.resolveDispute(admin2.access_token, disputeId, 'REVERSE', 'second admin', ctx.uuid(), su2.body.step_up_token),
    ]);

    const won = results.filter((r) => r.status === 200).length;
    ctx.expectEq(won, 1, 'exactly one admin won');
    const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.disputes WHERE id = $1`, [disputeId]);
    ctx.expect(['REJECTED', 'REVERSED'].includes(rows[0].state), `terminal state (${rows[0].state})`);
  },
};

export const DIS_11: Scenario = {
  id: 'DIS-11',
  name: 'Every resolution wrote an audit_log row with before/after',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS11');
    await ctx.makeAdmin(admin);
    const txn = await ctx.transfer(a, b, 90_000);
    const txnId = txn.body.transaction.id;
    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'audit me');
    const disputeId = dispute.body.id;

    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    await ctx.client.resolveDispute(
      admin.access_token,
      disputeId,
      'REJECT',
      'No error found.',
      ctx.uuid(),
      su.body.step_up_token,
    );

    const { rows } = await ctx.adminPool.query(
      `SELECT actor_id, action, entity, entity_id, before, after FROM ledger.audit_log
        WHERE entity = 'dispute' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
      [disputeId],
    );
    ctx.expectEq(rows.length, 1, 'audit row exists');
    ctx.expectEq(rows[0].actor_id, admin.user.id, 'actor is admin');
    const before = typeof rows[0].before === 'string' ? JSON.parse(rows[0].before) : rows[0].before;
    const after = typeof rows[0].after === 'string' ? JSON.parse(rows[0].after) : rows[0].after;
    ctx.expectEq(before.state, 'OPEN', 'before state OPEN');
    ctx.expectEq(after.state, 'REJECTED', 'after state REJECTED');
  },
};

export const DIS_12: Scenario = {
  id: 'DIS-12',
  name: 'After REVERSE, both parties\' ledger.v_user_reputation score dropped',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    // Ported from scenarios/disputes.ts (Antigravity R4) — the one check
    // this file didn't already have. See CLAUDE_BUILD_LOG.md for why the
    // two files were merged instead of run side by side.
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS12');
    await ctx.makeAdmin(admin);

    const repA1 = await ctx.adminPool.query(`SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`, [a.user.id]);
    const repB1 = await ctx.adminPool.query(`SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`, [b.user.id]);
    const scoreA1 = repA1.rows[0].reputation_score;
    const scoreB1 = repB1.rows[0].reputation_score;

    const txn = await ctx.transfer(a, b, 50_000);
    const dispute = await ctx.client.raiseDispute(a.access_token, txn.body.transaction.id, 'Wrong account');

    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    await ctx.client.resolveDispute(
      admin.access_token,
      dispute.body.id,
      'REVERSE',
      'Approved reversal.',
      ctx.uuid(),
      su.body.step_up_token,
    );

    const repA2 = await ctx.adminPool.query(`SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`, [a.user.id]);
    const repB2 = await ctx.adminPool.query(`SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`, [b.user.id]);
    const scoreA2 = repA2.rows[0].reputation_score;
    const scoreB2 = repB2.rows[0].reputation_score;

    ctx.expect(scoreA2 < scoreA1, `sender reputation dropped: ${scoreA1} -> ${scoreA2}`);
    ctx.expect(scoreB2 < scoreB1, `receiver reputation dropped: ${scoreB1} -> ${scoreB2}`);
  },
};

export const disputeScenarios: Scenario[] = [DIS_01, DIS_02, DIS_03, DIS_04, DIS_05, DIS_06, DIS_07, DIS_08, DIS_09, DIS_10, DIS_11, DIS_12];