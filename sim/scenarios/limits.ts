import { Scenario } from '../harness/types';

/**
 * LIMITS & VELOCITY — SIMULATOR.md §4, Tier 3. Daily cap is enforced on the
 * money path (LedgerWriterService reads spentToday + limit_overrides).
 * Velocity (429) exists only on request-remind in this build, so the velocity
 * part is covered there (REQ-05) rather than on transfers.
 */

export const LIM_01: Scenario = {
  id: 'LIM-01',
  name: 'Daily cap enforced: over-limit transfer returns 403 DAILY_LIMIT_EXCEEDED',
  tags: ['limits', 'tier3'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'LIM01');
    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const stepUpToken = su.body.step_up_token;

    // Default daily limit is ৳50,000 = 5,000,000 paisa. Send 4,900,000 then
    // try another 200,000 — the second should trip the cap.
    const first = await ctx.client.transfer(a.access_token, b.user.phone, 4_900_000, {
      idemKey: ctx.uuid(),
      stepUpToken,
    });
    // 4,900,000 > 500k undo threshold => lands HELD (202); the daily-limit
    // check still runs inside moveMoney, so spent_today now includes it.
    ctx.expect([201, 202].includes(first.status), `first under cap accepted (${first.status})`);

    const second = await ctx.client.transfer(a.access_token, b.user.phone, 200_000, {
      idemKey: ctx.uuid(),
      stepUpToken,
    });
    ctx.expectEq(second.status, 403, 'over-cap rejected');
    ctx.expectEq(second.body.error, 'DAILY_LIMIT_EXCEEDED', 'DAILY_LIMIT_EXCEEDED');
  },
};

export const LIM_02: Scenario = {
  id: 'LIM-02',
  name: 'Remaining allowance is accurate',
  tags: ['limits', 'tier3'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'LIM02');
    const sent = 1_000_000;
    await ctx.transfer(a, b, sent);

    const limits = await ctx.client.limits(a.access_token);
    ctx.expectEq(limits.status, 200, 'limits endpoint');
    ctx.expectEq(limits.body.daily_limit_paisa, 5_000_000, 'default limit');
    ctx.expectEq(limits.body.spent_today_paisa, sent, 'spent today matches');
    ctx.expectEq(limits.body.remaining_paisa, 5_000_000 - sent, 'remaining accurate');
  },
};

export const LIM_03: Scenario = {
  id: 'LIM-03',
  name: 'Limit override lifts the cap (limit_overrides honoured)',
  tags: ['limits', 'tier3'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'LIM03');
    await ctx.adminPool.query(
      `INSERT INTO ledger.limit_overrides (user_id, daily_send_limit, set_by, reason)
       VALUES ($1, 100000000, $1, 'simulator: LIM-03 override')`,
      [a.user.id],
    );

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    // 6,000,000 > default 5,000,000 but under the 100,000,000 override. Also
    // above the 500k undo threshold => HELD (202) — the point is it's accepted.
    const res = await ctx.client.transfer(a.access_token, b.user.phone, 6_000_000, {
      idemKey: ctx.uuid(),
      stepUpToken: su.body.step_up_token,
    });
    ctx.expect([201, 202].includes(res.status), `override allows above default cap (${res.status})`);
  },
};

export const limitsScenarios: Scenario[] = [LIM_01, LIM_02, LIM_03];