import { Scenario } from '../harness/types';
import { abortAfter } from '../harness/client';

/**
 * IDEMPOTENCY — SIMULATOR.md §4, Tier 1. The one frontend bug that becomes a
 * double debit. Every scenario here hammers the same key and asserts exactly
 * one debit, or asserts the reuse/different-payload guard.
 */

export const IDEM_01: Scenario = {
  id: 'IDEM-01',
  name: 'Same key twice sequentially: one debit, identical response body',
  tags: ['idempotency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'IDEM01');
    const key = ctx.uuid();
    const amount = 50_000;
    const before = await ctx.balance(a);

    const first = await ctx.transfer(a, b, amount, { key });
    ctx.expectEq(first.status, 201, 'first accepted');

    const second = await ctx.client.transfer(a.access_token, b.user.phone, amount, { idemKey: key });
    ctx.expect(second.status < 300, 'replay accepted');
    ctx.expectEq(second.body.transaction.ref, first.body.transaction.ref, 'identical ref');
    ctx.expectEq(second.body.balance_paisa, first.body.balance_paisa, 'identical body');
    ctx.expectEq(await ctx.balance(a), before - amount, 'exactly one debit');
  },
};

export const IDEM_02: Scenario = {
  id: 'IDEM-02',
  name: 'Concurrent double-tap with one key debits exactly once',
  tags: ['idempotency', 'concurrency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'IDEM02');
    const key = ctx.uuid();
    const amount = 250_000;
    const before = await ctx.balance(a);

    // Pre-obtain a step-up token so the 10 parallel calls don't all race for
    // their own 403-then-retry (the server would handle it, but it would make
    // this scenario about step-up rather than idempotency).
    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const stepUpToken = su.body.step_up_token;

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        ctx.client.transfer(a.access_token, b.user.phone, amount, { idemKey: key, stepUpToken }),
      ),
    );
    ctx.expect(results.every((r) => r.status < 300), `all 10 accepted — got ${results.map((r) => r.status).join(',')}`);
    ctx.expectAllIdentical(results.map((r) => r.body.transaction.ref));
    ctx.expectEq(await ctx.balance(a), before - amount, 'exactly one debit');
    ctx.expectEq(await ctx.countTxns({ ref: results[0].body.transaction.ref }), 1, 'one transaction row');
  },
};

export const IDEM_03: Scenario = {
  id: 'IDEM-03',
  name: 'Same key, different amount: 422 IDEMPOTENCY_KEY_REUSE',
  tags: ['idempotency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'IDEM03');
    const key = ctx.uuid();
    await ctx.transfer(a, b, 50_000, { key });

    const reuse = await ctx.client.transfer(a.access_token, b.user.phone, 99_000, { idemKey: key });
    ctx.expectEq(reuse.status, 422, 'reuse rejected');
    ctx.expectEq(reuse.body.error, 'IDEMPOTENCY_KEY_REUSE', 'error code');
  },
};

export const IDEM_04: Scenario = {
  id: 'IDEM-04',
  name: 'User B replaying user A\'s key gets B\'s own result, never A\'s',
  tags: ['idempotency', 'tier1'],
  async run(ctx) {
    const [a, b, c, d] = await ctx.freshUsers(4, 'IDEM04');
    const key = ctx.uuid();
    const amount = 25_000;

    const aRes = await ctx.transfer(a, b, amount, { key });
    ctx.expectEq(aRes.status, 201, 'A accepted');

    // B uses the SAME key string against a DIFFERENT recipient. Key is scoped
    // (user_id, key) — this must create B's own transfer, not replay A's.
    // B has never sent to C before, so this also needs its own step-up —
    // use ctx.transfer (auto-retries with PIN) rather than the raw client
    // call, same as `a`'s leg above.
    const bBefore = await ctx.balance(b);
    const bRes = await ctx.transfer(b, c, amount, { key });
    ctx.expectEq(bRes.status, 201, 'B accepted (key is per-user)');
    ctx.expect(bRes.body.transaction.ref !== aRes.body.transaction.ref, 'B got a different transaction');

    // Now B replays B's OWN key: identical response, no second debit.
    const bReplay = await ctx.client.transfer(b.access_token, c.user.phone, amount, { idemKey: key });
    ctx.expectEq(bReplay.body.transaction.ref, bRes.body.transaction.ref, 'B replay identical');
    ctx.expectEq(await ctx.balance(b), bBefore - amount, 'exactly one debit for B');
  },
};

export const IDEM_05: Scenario = {
  id: 'IDEM-05',
  name: 'Abort mid-request, retry same key: exactly one debit',
  tags: ['idempotency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'IDEM05');
    const key = ctx.uuid();
    const amount = 60_000;
    const before = await ctx.balance(a);

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const stepUpToken = su.body.step_up_token;

    const aborted = await abortAfter(5, (signal) =>
      ctx.client.transfer(a.access_token, b.user.phone, amount, { idemKey: key, stepUpToken, signal }),
    );
    // Either the server committed before the abort, or it didn't. Either way
    // the retry with the same key must produce exactly one debit.
    const retry = await ctx.client.transfer(a.access_token, b.user.phone, amount, { idemKey: key, stepUpToken });
    ctx.expect(retry.status < 300, `retry accepted — got ${retry.status}`);
    ctx.expectEq(await ctx.balance(a), before - amount, 'exactly one debit after abort+retry');
    void aborted;
  },
};

export const IDEM_06: Scenario = {
  id: 'IDEM-06',
  name: 'Step-up retry after 403 reuses key: one debit',
  tags: ['idempotency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'IDEM06');
    const key = ctx.uuid();
    const amount = 3_000_000; // above step-up amount threshold
    const before = await ctx.balance(a);

    const denied = await ctx.client.transfer(a.access_token, b.user.phone, amount, { idemKey: key });
    ctx.expectEq(denied.status, 403, 'first attempt requires step-up');
    ctx.expectEq(denied.body.error, 'STEP_UP_REQUIRED', 'step-up code');

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const retried = await ctx.client.transfer(a.access_token, b.user.phone, amount, {
      idemKey: key,
      stepUpToken: su.body.step_up_token,
    });
    // This amount is above config.undoThresholdPaisa, so a successful
    // transfer lands as HELD (202), not COMPLETED (201) — see PLAN.md §4.2
    // and transfers.controller.ts. Either way it's still exactly one debit,
    // which is the property this scenario is actually about.
    ctx.expect(retried.status === 201 || retried.status === 202, `retry with same key succeeds — got ${retried.status}`);
    ctx.expectEq(await ctx.balance(a), before - amount, 'exactly one debit');
  },
};

export const idempotencyScenarios: Scenario[] = [IDEM_01, IDEM_02, IDEM_03, IDEM_04, IDEM_05, IDEM_06];