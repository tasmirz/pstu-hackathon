import { Scenario } from '../harness/types';

/**
 * REVERSAL — SIMULATOR.md §4, Tier 2. A reversal is a NEW transaction, never
 * an edit. The original row stays byte-identical; the second reversal is
 * blocked by a unique index (CAS + index, not an if).
 */

export const REV_01: Scenario = {
  id: 'REV-01',
  name: 'Reversal creates a new txn; the original row is byte-identical afterwards',
  tags: ['reversal', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'REV01');
    const amount = 250_000;
    const txn = await ctx.transfer(a, b, amount);
    const txnId = txn.body.transaction.id;

    const originalBefore = await ctx.adminPool.query(`SELECT * FROM ledger.transactions WHERE id = $1`, [txnId]);

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const rev = await ctx.client.reverse(a.access_token, txnId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(rev.status, 201, 'reversal accepted');
    ctx.expectEq(rev.body.reversal.kind, 'REVERSAL', 'new txn kind REVERSAL');
    ctx.expect(rev.body.reversal.id !== txnId, 'new transaction id');

    const originalAfter = await ctx.adminPool.query(`SELECT * FROM ledger.transactions WHERE id = $1`, [txnId]);
    ctx.expectEq(originalAfter.rows[0].amount, originalBefore.rows[0].amount, 'amount unchanged');
    ctx.expectEq(originalAfter.rows[0].ref, originalBefore.rows[0].ref, 'ref unchanged');
    ctx.expectEq(originalAfter.rows[0].kind, originalBefore.rows[0].kind, 'kind unchanged');
    ctx.expectEq(originalAfter.rows[0].state, 'REVERSED', 'state flipped to REVERSED');
  },
};

export const REV_02: Scenario = {
  id: 'REV-02',
  name: 'Second reversal: 409 (unique index, not an if)',
  tags: ['reversal', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'REV02');
    const txn = await ctx.transfer(a, b, 180_000);
    const txnId = txn.body.transaction.id;

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const first = await ctx.client.reverse(a.access_token, txnId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(first.status, 201, 'first reversal ok');

    const second = await ctx.client.reverse(a.access_token, txnId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(second.status, 409, 'second reversal blocked');
    ctx.expectEq(second.body.error, 'INVALID_STATE', 'INVALID_STATE');
  },
};

export const REV_03: Scenario = {
  id: 'REV-03',
  name: 'Receiver already spent it: 402, no money fabricated',
  tags: ['reversal', 'tier2'],
  async run(ctx) {
    const [a, b, c] = await ctx.freshUsers(3, 'REV03');
    const amount = 300_000; // under the 500k undo threshold => normal COMPLETED transfer

    // a -> b a normal, reversible transfer.
    const txn = await ctx.transfer(a, b, amount);
    ctx.expectEq(txn.status, 201, 'a->b completed');
    const txnId = txn.body.transaction.id;

    // Give B a huge daily limit so B can send its whole balance away (a legit
    // admin override — API.md `POST /admin/limits/:userId`).
    await ctx.adminPool.query(
      `INSERT INTO ledger.limit_overrides (user_id, daily_send_limit, set_by, reason)
       VALUES ($1, 1000000000, $1, 'simulator: REV-03 drain') ON CONFLICT (user_id) DO UPDATE SET daily_send_limit = 1000000000`,
      [b.user.id],
    );

    // Drain B entirely to C — B has now spent everything it received.
    const bBal = await ctx.balance(b);
    const suB = await ctx.client.stepUp(b.access_token, 'PIN', b.pin);
    let remaining = bBal;
    while (remaining > 0) {
      const chunk = Math.min(500_000, remaining);
      const drain = await ctx.client.transfer(b.access_token, c.user.phone, chunk, {
        idemKey: ctx.uuid(),
        stepUpToken: suB.body.step_up_token,
      });
      ctx.expectEq(drain.status, 201, 'drain chunk completed');
      remaining -= chunk;
    }
    ctx.expectEq(await ctx.balance(b), 0, 'B has nothing left');
    const beforeA = await ctx.balance(a);
    const beforeC = await ctx.balance(c);

    // A reverses the original transfer; B cannot cover it -> 402, no money fabricated.
    const suA = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const rev = await ctx.client.reverse(a.access_token, txnId, ctx.uuid(), suA.body.step_up_token);
    ctx.expectEq(rev.status, 402, 'reversal fails — receiver already spent it');
    ctx.expectEq(rev.body.error, 'INSUFFICIENT_FUNDS', 'INSUFFICIENT_FUNDS');
    ctx.expectEq(await ctx.balance(a), beforeA, 'sender unchanged');
    ctx.expectEq(await ctx.balance(c), beforeC, 'recipient of drain unchanged');
  },
};

export const REV_04: Scenario = {
  id: 'REV-04',
  name: 'Reversal of a reversal: blocked',
  tags: ['reversal', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'REV04');
    const txn = await ctx.transfer(a, b, 150_000);
    const txnId = txn.body.transaction.id;

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const first = await ctx.client.reverse(a.access_token, txnId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(first.status, 201, 'first reversal ok');
    const reversalId = first.body.reversal.id;

    // Attempt to reverse the REVERSAL itself.
    const su2 = await ctx.client.stepUp(b.access_token, 'PIN', b.pin);
    const second = await ctx.client.reverse(b.access_token, reversalId, ctx.uuid(), su2.body.step_up_token);
    ctx.expectEq(second.status, 409, 'reversal of a reversal blocked');
    ctx.expectEq(second.body.error, 'INVALID_STATE', 'INVALID_STATE');
  },
};

export const reversalScenarios: Scenario[] = [REV_01, REV_02, REV_03, REV_04];
