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
    const stepUp = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    ctx.expectEq(stepUp.status, 200, 'step-up obtained');

    const res = await ctx.client.transfer(a.access_token, b.user.phone, before + 1, {
      idemKey: ctx.uuid(),
      stepUpToken: stepUp.body.step_up_token,
    });
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
    const stepUp = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    ctx.expectEq(stepUp.status, 200, 'step-up obtained');

    const res = await ctx.client.transfer(a.access_token, b.user.phone, 500, {
      idemKey: ctx.uuid(),
      stepUpToken: stepUp.body.step_up_token,
    });
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

export const VAL_09: Scenario = {
  id: 'VAL-09',
  name: 'Wrong PIN returns the exact non-identifying authentication error shape',
  tags: ['validation', 'auth'],
  async run(ctx) {
    const user = await ctx.freshUser('VAL09 Wrong PIN');
    const result = await ctx.client.login(user.user.phone, '9999');

    ctx.expectEq(result.status, 401, 'wrong PIN status');
    ctx.expectEq(result.body as any, {
      error: 'UNAUTHENTICATED',
      message: 'Invalid phone number or PIN',
      details: { attempts_remaining: 4 },
    }, 'wrong PIN response body');
  },
};

export const VAL_10: Scenario = {
  id: 'VAL-10',
  name: 'Refresh-token replay is detected and revokes the whole rotation family',
  tags: ['validation', 'auth'],
  async run(ctx) {
    const user = await ctx.freshUser('VAL10 Refresh Replay');
    const originalToken = user.refresh_token;

    const rotated = await ctx.client.refresh(originalToken);
    ctx.expectEq(rotated.status, 200, 'first refresh rotates successfully');
    ctx.expect(!!rotated.body.refresh_token, 'rotation returns a replacement refresh token');

    const replay = await ctx.client.refresh(originalToken);
    ctx.expectEq(replay.status, 401, 'consumed token is rejected');
    ctx.expectEq((replay.body as any).error, 'TOKEN_REUSE_DETECTED', 'replay error code');

    const replacementAfterReplay = await ctx.client.refresh(rotated.body.refresh_token);
    ctx.expectEq(replacementAfterReplay.status, 401, 'replacement token was family-revoked');
    ctx.expectEq((replacementAfterReplay.body as any).error, 'TOKEN_REUSE_DETECTED', 'family revocation error code');

    const originalAfterRevocation = await ctx.client.refresh(originalToken);
    ctx.expectEq(originalAfterRevocation.status, 401, 'original token remains rejected after family revocation');
    ctx.expectEq((originalAfterRevocation.body as any).error, 'TOKEN_REUSE_DETECTED', 'original remains a detected replay');

    const family = await ctx.adminPool.query<{ token_count: number; all_revoked: boolean }>(
      `SELECT COUNT(*)::int AS token_count,
              BOOL_AND(revoked_at IS NOT NULL) AS all_revoked
         FROM auth.refresh_tokens
        WHERE user_id = $1`,
      [user.user.id],
    );
    ctx.expectEq(family.rows[0].token_count, 2, 'rotation family has original and replacement rows');
    ctx.expectEq(family.rows[0].all_revoked, true, 'every token in the family is revoked');
  },
};

export const VAL_11: Scenario = {
  id: 'VAL-11',
  name: 'Lookup of an unknown phone returns 404 USER_NOT_FOUND',
  tags: ['validation', 'query'],
  async run(ctx) {
    const requester = await ctx.freshUser('VAL11 Lookup Requester');
    const unknownPhone = `+999${String(Date.now()).slice(-10)}`;
    const result = await ctx.client.lookup(requester.access_token, unknownPhone);

    ctx.expectEq(result.status, 404, 'lookup miss status');
    ctx.expectEq(result.body.error, 'USER_NOT_FOUND', 'lookup miss error code');
    ctx.expectEq(result.body.message, 'User not found', 'lookup miss message');
  },
};

export const VAL_12: Scenario = {
  id: 'VAL-12',
  name: 'A non-admin cannot read the admin integrity endpoint',
  tags: ['validation', 'admin'],
  async run(ctx) {
    const user = await ctx.freshUser('VAL12 Non Admin');
    const result = await ctx.client.integrity(user.access_token);

    ctx.expectEq(result.status, 403, 'non-admin status');
    ctx.expectEq(result.body, {
      error: 'FORBIDDEN',
      message: 'This action requires the ADMIN role',
    }, 'non-admin response body');
  },
};

export const VAL_13: Scenario = {
  id: 'VAL-13',
  name: 'Registering an already-taken phone returns the stable validation error',
  tags: ['validation', 'auth'],
  async run(ctx) {
    const user = await ctx.freshUser('VAL13 Duplicate Phone');
    const duplicate = await ctx.client.register(user.user.phone, 'Duplicate User', user.pin);

    ctx.expectEq(duplicate.status, 400, 'duplicate phone status');
    ctx.expectEq(duplicate.body as any, {
      error: 'VALIDATION_ERROR',
      message: 'That phone number is already registered',
    }, 'duplicate phone response body');
  },
};

export const VAL_14: Scenario = {
  id: 'VAL-14',
  name: 'Lookup reputation score exactly matches the derived SQL view',
  tags: ['validation', 'query'],
  async run(ctx) {
    const [requester, target] = await ctx.freshUsers(2, 'VAL14 Reputation');
    const lookup = await ctx.client.lookup(requester.access_token, target.user.phone);
    ctx.expectEq(lookup.status, 200, 'lookup status');

    const reputation = await ctx.adminPool.query<{ reputation_score: number }>(
      `SELECT reputation_score
         FROM ledger.v_user_reputation
        WHERE user_id = $1`,
      [target.user.id],
    );
    ctx.expectEq(reputation.rows.length, 1, 'reputation view row exists');
    ctx.expectEq(
      lookup.body.reputation.score,
      reputation.rows[0].reputation_score,
      'HTTP reputation score matches SQL view',
    );
    ctx.expectEq(lookup.body.reputation.tier, 'FAIR', 'fresh user score maps to FAIR');
  },
};

export const validationScenarios: Scenario[] = [
  VAL_01,
  VAL_02,
  VAL_03,
  VAL_04,
  VAL_05,
  VAL_06,
  VAL_07,
  VAL_08,
  VAL_09,
  VAL_10,
  VAL_11,
  VAL_12,
  VAL_13,
  VAL_14,
];
