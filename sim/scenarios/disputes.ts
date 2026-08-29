import { Scenario } from '../harness/types';

/**
 * DISPUTES — SIMULATOR.md §4 / TASKS_ANTIGRAVITY.md Round 4.
 * Exercises raise, list, reject, reverse, failure accounting, and reputation drop.
 */

export const DIS_01: Scenario = {
  id: 'DIS-01',
  name: 'Raise a dispute on completed transfer, admin resolves REVERSE, assert money moved back & state REVERSED',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS01');
    await ctx.makeAdmin(admin);
    const amount = 200_000;
    const beforeA = await ctx.balance(a);
    const beforeB = await ctx.balance(b);

    const txn = await ctx.transfer(a, b, amount);
    const txnId = txn.body.transaction.id;
    ctx.expectEq(await ctx.balance(a), beforeA - amount, 'a debited');
    ctx.expectEq(await ctx.balance(b), beforeB + amount, 'b credited');

    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'Sent to wrong person');
    ctx.expectEq(dispute.status, 201, 'dispute raised');
    ctx.expectEq(dispute.body.state, 'OPEN', 'OPEN');

    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    const resolved = await ctx.client.resolveDispute(
      admin.access_token,
      dispute.body.id,
      'REVERSE',
      'Confirmed wrong recipient, funds returned.',
      ctx.uuid(),
      su.body.step_up_token,
    );
    ctx.expectEq(resolved.status, 200, 'admin reversed');
    ctx.expectEq(resolved.body.dispute.state, 'REVERSED', 'dispute REVERSED');
    ctx.expectEq(resolved.body.reversal.kind, 'REVERSAL', 'reversal kind');

    // Money moved back
    ctx.expectEq(await ctx.balance(a), beforeA, 'a refunded');
    ctx.expectEq(await ctx.balance(b), beforeB, 'b decremented');

    // GET /disputes shows REVERSED
    const myDisputes = await ctx.client.myDisputes(a.access_token);
    ctx.expectEq(myDisputes.status, 200, 'myDisputes ok');
    ctx.expect(myDisputes.body.items.some((d: any) => d.id === dispute.body.id && d.state === 'REVERSED'), 'dispute shows REVERSED in list');
  },
};

export const DIS_02: Scenario = {
  id: 'DIS-02',
  name: 'Admin resolves REJECT: no money moves, dispute closes REJECTED',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS02');
    await ctx.makeAdmin(admin);
    const amount = 100_000;

    const txn = await ctx.transfer(a, b, amount);
    const txnId = txn.body.transaction.id;
    const balanceABeforeReject = await ctx.balance(a);
    const balanceBBeforeReject = await ctx.balance(b);

    const dispute = await ctx.client.raiseDispute(a.access_token, txnId, 'Mistake claimed');
    const su = await ctx.client.stepUp(admin.access_token, 'PIN', admin.pin);
    const resolved = await ctx.client.resolveDispute(
      admin.access_token,
      dispute.body.id,
      'REJECT',
      'Legitimate transfer confirmed.',
      ctx.uuid(),
      su.body.step_up_token,
    );
    ctx.expectEq(resolved.status, 200, 'rejected');
    ctx.expectEq(resolved.body.dispute.state, 'REJECTED', 'REJECTED');

    // No money moves
    ctx.expectEq(await ctx.balance(a), balanceABeforeReject, 'sender balance untouched');
    ctx.expectEq(await ctx.balance(b), balanceBBeforeReject, 'receiver balance untouched');
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

    const first = await ctx.client.raiseDispute(a.access_token, txnId, 'first claim');
    ctx.expectEq(first.status, 201, 'first dispute created');

    const second = await ctx.client.raiseDispute(a.access_token, txnId, 'second attempt');
    ctx.expectEq(second.status, 409, 'second dispute blocked');
    ctx.expectEq(second.body.error, 'DISPUTE_ALREADY_OPEN', 'DISPUTE_ALREADY_OPEN');
  },
};

export const DIS_04: Scenario = {
  id: 'DIS-04',
  name: 'Third user tries to raise dispute on someone else\'s transaction: 403 NOT_A_PARTY',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, stranger] = await ctx.freshUsers(3, 'DIS04');
    const txn = await ctx.transfer(a, b, 60_000);
    const txnId = txn.body.transaction.id;

    const res = await ctx.client.raiseDispute(stranger.access_token, txnId, 'not my business');
    ctx.expectEq(res.status, 403, 'non-party rejected');
    ctx.expectEq(res.body.error, 'NOT_A_PARTY', 'NOT_A_PARTY');
  },
};

export const DIS_05: Scenario = {
  id: 'DIS-05',
  name: 'After REVERSE, spot-check both parties\' ledger.v_user_reputation score dropped',
  tags: ['disputes', 'dispute', 'tier2'],
  async run(ctx) {
    const [a, b, admin] = await ctx.freshUsers(3, 'DIS05');
    await ctx.makeAdmin(admin);

    // Initial reputation scores
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

    // Reputation score drops by 15 points per reversed dispute
    const repA2 = await ctx.adminPool.query(`SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`, [a.user.id]);
    const repB2 = await ctx.adminPool.query(`SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`, [b.user.id]);
    const scoreA2 = repA2.rows[0].reputation_score;
    const scoreB2 = repB2.rows[0].reputation_score;

    ctx.expect(scoreA2 < scoreA1, `sender reputation dropped: ${scoreA1} -> ${scoreA2}`);
    ctx.expect(scoreB2 < scoreB1, `receiver reputation dropped: ${scoreB1} -> ${scoreB2}`);
  },
};

export const disputeScenarios: Scenario[] = [DIS_01, DIS_02, DIS_03, DIS_04, DIS_05];
export const disputesScenarios: Scenario[] = disputeScenarios;
