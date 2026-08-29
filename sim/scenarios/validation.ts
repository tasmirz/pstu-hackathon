import { Scenario } from '../harness/types';

/**
 * VALIDATION — SIMULATOR.md §4, Tier 1. Inputs that must be rejected WITHOUT
 * touching the ledger. VAL-01 and VAL-07 need a real transfer path (they're
 * ledger facts), everything else is pure request validation.
 */

export const VAL_01: Scenario = {
  id: 'VAL-01',
  name: 'Transfer exceeding balance: 402, zero entries written',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'VAL01');
    const before = await ctx.balance(a);
    const txnsBefore = await ctx.countTxns({});

    const res = await ctx.client.transfer(a.access_token, b.user.phone, before + 1, { idemKey: ctx.uuid() });
    ctx.expectEq(res.status, 402, 'insufficient funds');
    ctx.expectEq(res.body.error, 'INSUFFICIENT_FUNDS', 'error code');

    ctx.expectEq(await ctx.balance(a), before, 'balance unchanged');
    ctx.expectEq(await ctx.countTxns({}), txnsBefore, 'no new transaction row');
  },
};

export const VAL_02: Scenario = {
  id: 'VAL-02',
  name: 'Amount 0: 400',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'VAL02');
    const res = await ctx.client.transfer(a.access_token, b.user.phone, 0, { idemKey: ctx.uuid() });
    ctx.expectEq(res.status, 400, 'zero amount rejected');
  },
};

export const VAL_03: Scenario = {
  id: 'VAL-03',
  name: 'Negative amount: 400',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'VAL03');
    const res = await ctx.client.transfer(a.access_token, b.user.phone, -500, { idemKey: ctx.uuid() });
    ctx.expectEq(res.status, 400, 'negative amount rejected');
  },
};

export const VAL_04: Scenario = {
  id: 'VAL-04',
  name: 'Self-transfer: 422',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const a = await ctx.freshUser('VAL04');
    const res = await ctx.client.transfer(a.access_token, a.user.phone, 500, { idemKey: ctx.uuid() });
    ctx.expectEq(res.status, 422, 'self-transfer rejected');
    ctx.expectEq(res.body.error, 'SELF_TRANSFER', 'error code');
  },
};

export const VAL_05: Scenario = {
  id: 'VAL-05',
  name: 'Unknown recipient: 404',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const a = await ctx.freshUser('VAL05');
    const res = await ctx.client.transfer(a.access_token, '+8809999999999', 500, { idemKey: ctx.uuid() });
    ctx.expectEq(res.status, 404, 'unknown recipient');
  },
};

export const VAL_06: Scenario = {
  id: 'VAL-06',
  name: 'Frozen sender cannot send: 403',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'VAL06');
    await ctx.adminPool.query(`UPDATE auth.users SET status = 'FROZEN' WHERE id = $1`, [a.user.id]);

    const res = await ctx.client.transfer(a.access_token, b.user.phone, 500, { idemKey: ctx.uuid() });
    ctx.expectEq(res.status, 403, 'frozen sender rejected');
    ctx.expectEq(res.body.error, 'ACCOUNT_FROZEN', 'error code');
    // cleanup so universal invariants and later scenarios are unaffected
    await ctx.adminPool.query(`UPDATE auth.users SET status = 'ACTIVE' WHERE id = $1`, [a.user.id]);
  },
};

export const VAL_07: Scenario = {
  id: 'VAL-07',
  name: 'Frozen account can still receive: 201',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'VAL07');
    await ctx.adminPool.query(`UPDATE auth.users SET status = 'FROZEN' WHERE id = $1`, [b.user.id]);
    const beforeB = await ctx.balance(b);

    const res = await ctx.transfer(a, b, 75_000);
    ctx.expectEq(res.status, 201, 'frozen receiver accepts money');
    ctx.expectEq(await ctx.balance(b), beforeB + 75_000, 'receiver credited');
    await ctx.adminPool.query(`UPDATE auth.users SET status = 'ACTIVE' WHERE id = $1`, [b.user.id]);
  },
};

export const VAL_08: Scenario = {
  id: 'VAL-08',
  name: 'Float amount (250.5) rejected, never truncated',
  tags: ['validation', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'VAL08');
    const before = await ctx.balance(a);
    // Send as a raw JSON number 250.5 — IsInt must reject it outright.
    const res = await ctx.client.transfer(a.access_token, b.user.phone, 250.5 as any, { idemKey: ctx.uuid() });
    ctx.expectEq(res.status, 400, 'float rejected');
    ctx.expectEq(await ctx.balance(a), before, 'no partial amount moved');
  },
};

export const validationScenarios: Scenario[] = [VAL_01, VAL_02, VAL_03, VAL_04, VAL_05, VAL_06, VAL_07, VAL_08];