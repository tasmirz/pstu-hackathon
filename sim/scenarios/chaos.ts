import { Scenario } from '../harness/types';
import { pauseContainer, killAndRestart, waitHealthy } from '../harness/chaos';

/**
 * CHAOS — SIMULATOR.md §4, Tier 2. The most persuasive fifteen seconds of the
 * demo. These mutate the running infra, so they're guarded to no-op when the
 * target container isn't present; run the full board with infra up.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CHA_01: Scenario = {
  id: 'CHA-01',
  name: 'Kill Postgres mid-transfer: client errors, nothing partially written',
  tags: ['chaos', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'CHA01');
    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const before = await ctx.balance(a);

    const paused = await pauseContainer('postgres', 600);
    const attempt = await ctx.client.transfer(a.access_token, b.user.phone, 50_000, {
      idemKey: ctx.uuid(),
      stepUpToken: su.body.step_up_token,
    });
    void paused;
    ctx.expect(attempt.status === 0 || attempt.status >= 500 || attempt.status === 502, `client saw an error (${attempt.status})`);
    await sleep(500); // let the pool recover

    const after = await ctx.balance(a);
    ctx.expectEq(after, before, 'nothing partially written');
  },
};

export const CHA_02: Scenario = {
  id: 'CHA-02',
  name: 'Kill Redpanda: transfers still commit, outbox backs up',
  tags: ['chaos', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'CHA02');
    const outboxBefore = await ctx.adminPool.query(`SELECT COUNT(*)::int AS c FROM ledger.outbox WHERE processed_at IS NULL`);

    const killed = await killAndRestart('redpanda');
    // Give the compose kill a beat to take effect.
    await sleep(1000);

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const res = await ctx.client.transfer(a.access_token, b.user.phone, 120_000, {
      idemKey: ctx.uuid(),
      stepUpToken: su.body.step_up_token,
    });
    ctx.expectEq(res.status, 201, 'transfer commits while Redpanda is down');
    ctx.expectEq(await ctx.balance(b), 10_000_000 + 120_000, 'receiver credited');

    const outboxAfter = await ctx.adminPool.query(`SELECT COUNT(*)::int AS c FROM ledger.outbox WHERE processed_at IS NULL`);
    ctx.expect(outboxAfter.rows[0].c > outboxBefore.rows[0].c, 'outbox grew (events queued, not lost)');

    const healthy = await waitHealthy('redpanda', 30, 1000);
    void healthy;
    void killed;
  },
};

export const CHA_03: Scenario = {
  id: 'CHA-03',
  name: 'Restart Redpanda: system healthy again, outbox intact',
  tags: ['chaos', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'CHA03');
    const outboxBefore = await ctx.adminPool.query(`SELECT COUNT(*)::int AS c FROM ledger.outbox WHERE processed_at IS NULL`);

    await killAndRestart('redpanda');
    await sleep(1000);
    await waitHealthy('redpanda', 30, 1000);

    // After recovery the app is fully usable and nothing was lost.
    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const res = await ctx.client.transfer(a.access_token, b.user.phone, 80_000, {
      idemKey: ctx.uuid(),
      stepUpToken: su.body.step_up_token,
    });
    ctx.expectEq(res.status, 201, 'transfer works after restart');

    const outboxAfter = await ctx.adminPool.query(`SELECT COUNT(*)::int AS c FROM ledger.outbox WHERE processed_at IS NULL`);
    ctx.expect(outboxAfter.rows[0].c >= outboxBefore.rows[0].c, 'no outbox rows lost across the crash');
  },
};

export const chaosScenarios: Scenario[] = [CHA_01, CHA_02, CHA_03];