import { Scenario } from '../harness/types';

/**
 * AUTH — SIMULATOR.md §4, Tier 2. Refresh rotation, family revocation on
 * replay, PIN lockout, logout-all via token_version. AUTH-05 (TOTP replay)
 * is out of scope — the backend ships PIN step-up only.
 */

export const AUTH_01: Scenario = {
  id: 'AUTH-01',
  name: 'Refresh rotation issues a new token and consumes the old',
  tags: ['auth', 'tier2'],
  async run(ctx) {
    const u = await ctx.freshUser('AUTH01');
    const oldRefresh = u.refresh_token;

    const rotated = await ctx.client.refresh(oldRefresh);
    ctx.expectEq(rotated.status, 200, 'refresh ok');
    ctx.expect(rotated.body.refresh_token !== oldRefresh, 'new refresh token issued');

    // The old token is now consumed — refreshing with it is a replay.
    const replay = await ctx.client.refresh(oldRefresh);
    ctx.expectEq(replay.status, 401, 'old token replayed');
    ctx.expectEq(replay.body.error, 'TOKEN_REUSE_DETECTED', 'TOKEN_REUSE_DETECTED');
  },
};

export const AUTH_02: Scenario = {
  id: 'AUTH-02',
  name: 'Replaying a consumed refresh token revokes the whole family',
  tags: ['auth', 'tier2'],
  async run(ctx) {
    const u = await ctx.freshUser('AUTH02');
    const rt1 = await ctx.client.refresh(u.refresh_token);
    const rt2 = await ctx.client.refresh(rt1.body.refresh_token); // rotate forward
    ctx.expectEq(rt2.status, 200, 'second rotation ok');

    // Replay the FIRST token — it was consumed in AUTH-01's rotation chain.
    const replay = await ctx.client.refresh(u.refresh_token);
    ctx.expectEq(replay.status, 401, 'replayed first token rejected');
    ctx.expectEq(replay.body.error, 'TOKEN_REUSE_DETECTED', 'family revoked');

    // Even the most recent family member is now revoked.
    const newest = await ctx.client.refresh(rt1.body.refresh_token);
    ctx.expectEq(newest.status, 401, 'entire family revoked');
  },
};

export const AUTH_03: Scenario = {
  id: 'AUTH-03',
  name: '5 wrong PINs: 423 ACCOUNT_LOCKED',
  tags: ['auth', 'tier2'],
  async run(ctx) {
    const u = await ctx.freshUser('AUTH03');
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await ctx.client.login(u.user.phone, '0000'));
    }
    const last = results[results.length - 1];
    ctx.expectEq(last.status, 423, 'locked after 5 wrong PINs');
    ctx.expectEq(last.body.error, 'ACCOUNT_LOCKED', 'ACCOUNT_LOCKED');
    ctx.expect(!!last.body.details?.locked_until, 'locked_until present');

    // Locked account cannot log in even with the right PIN.
    const locked = await ctx.client.login(u.user.phone, u.pin);
    ctx.expectEq(locked.status, 423, 'still locked with correct PIN');
  },
};

export const AUTH_04: Scenario = {
  id: 'AUTH-04',
  name: 'logout-all invalidates outstanding access tokens via token_version',
  tags: ['auth', 'tier2'],
  async run(ctx) {
    const u = await ctx.freshUser('AUTH04');

    const me1 = await ctx.client.me(u.access_token);
    ctx.expectEq(me1.status, 200, 'token works before logout-all');

    const logoutAll = await ctx.client.logoutAll(u.access_token);
    ctx.expectEq(logoutAll.status, 200, 'logout-all ok');
    ctx.expectEq(logoutAll.body.sessions_revoked, 1, 'one family revoked');

    const me2 = await ctx.client.me(u.access_token);
    ctx.expectEq(me2.status, 401, 'same access token now rejected');
  },
};

export const authScenarios: Scenario[] = [AUTH_01, AUTH_02, AUTH_03, AUTH_04];