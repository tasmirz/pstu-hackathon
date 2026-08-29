import { Scenario } from '../harness/types';
import { generateTotp } from '@pstu/shared';

/**
 * AUTH — SIMULATOR.md §4, Tier 2. Refresh rotation, family revocation on
 * replay, PIN lockout, logout-all via token_version, and TOTP 2FA step-up.
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
    ctx.expectEq((replay.body as any).error, 'TOKEN_REUSE_DETECTED', 'TOKEN_REUSE_DETECTED');
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
    ctx.expectEq((replay.body as any).error, 'TOKEN_REUSE_DETECTED', 'family revoked');

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
    const results: any[] = [];
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

export const AUTH_05: Scenario = {
  id: 'AUTH-05',
  name: 'TOTP setup, verify, and step-up authentication',
  tags: ['auth', 'totp', 'tier2'],
  async run(ctx) {
    const u = await ctx.freshUser('AUTH05');

    // 1. Initially TOTP not enrolled
    const meBefore = await ctx.client.me(u.access_token);
    ctx.expectEq(meBefore.body.totp_enrolled, false, 'totp not enrolled initially');

    // 2. Setup TOTP -> returns secret and otpauth_url
    const setup = await ctx.client.totpSetup(u.access_token);
    ctx.expectEq(setup.status, 200, 'setup ok');
    ctx.expect(!!setup.body.secret, 'secret returned');
    ctx.expect(setup.body.otpauth_url.includes(encodeURIComponent(u.user.phone)), 'otpauth_url formatted with phone');

    // 3. Verify with invalid code -> 401
    const invalidVerify = await ctx.client.totpVerify(u.access_token, '000000');
    ctx.expectEq(invalidVerify.status, 401, 'invalid code rejected');

    // 4. Verify with valid TOTP code
    const validCode = generateTotp(setup.body.secret);
    const verify = await ctx.client.totpVerify(u.access_token, validCode);
    ctx.expectEq(verify.status, 200, 'verify ok');

    const meAfter = await ctx.client.me(u.access_token);
    ctx.expectEq(meAfter.body.totp_enrolled, true, 'totp enrolled now');

    // 5. Step-up with TOTP
    const su = await ctx.client.stepUp(u.access_token, 'TOTP', validCode);
    ctx.expectEq(su.status, 200, 'step-up with TOTP succeeded');
    ctx.expect(!!su.body.step_up_token, 'step_up_token returned');
  },
};

export const authScenarios: Scenario[] = [AUTH_01, AUTH_02, AUTH_03, AUTH_04, AUTH_05];