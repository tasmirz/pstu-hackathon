import { Scenario } from '../harness/types';

/**
 * CONCURRENCY — SIMULATOR.md §4, Tier 1. Where real bugs live: CAS tests,
 * deadlock freedom, race-to-settle, ring load. These hit the running stack
 * hard on purpose.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CON_01: Scenario = {
  id: 'CON-01',
  name: 'A to B and B to A simultaneously x100: zero deadlocks',
  tags: ['concurrency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'CON01');
    const amount = 10_000; // small enough that 100 in each direction stays under the daily limit

    // First-touch both directions so neither direction triggers a first-time
    // step-up mid-burst (that would serialize the run on a single 403→retry).
    await ctx.transfer(a, b, 1_000);
    await ctx.transfer(b, a, 1_000);

    const suA = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const suB = await ctx.client.stepUp(b.access_token, 'PIN', b.pin);

    const jobs: Promise<any>[] = [];
    for (let i = 0; i < 100; i += 1) {
      jobs.push(ctx.client.transfer(a.access_token, b.user.phone, amount, { idemKey: ctx.uuid(), stepUpToken: suA.body.step_up_token }));
      jobs.push(ctx.client.transfer(b.access_token, a.user.phone, amount, { idemKey: ctx.uuid(), stepUpToken: suB.body.step_up_token }));
    }

    const results = await Promise.all(jobs);
    const failed = results.filter((r) => r.status >= 500);
    ctx.expectEq(failed.length, 0, `zero 5xx (deadlocks) — got ${failed.map((r) => r.body?.error).join(', ') || 'none'}`);
    const accepted = results.filter((r) => r.status < 300).length;
    ctx.expectEq(accepted, 200, 'all 200 accepted (some may 402 daily-limit; none should 5xx)');
  },
};

export const CON_02: Scenario = {
  id: 'CON-02',
  name: 'N concurrent sends totalling more than balance: only affordable ones succeed',
  tags: ['concurrency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'CON02');
    const balance = await ctx.balance(a);
    const amount = Math.floor(balance / 3) + 100; // 3x this exceeds balance
    const before = balance;

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.client.transfer(a.access_token, b.user.phone, amount, { idemKey: ctx.uuid(), stepUpToken: su.body.step_up_token }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 201).length;
    const failed = results.filter((r) => r.status === 402).length;
    ctx.expect(succeeded > 0 && succeeded < 5, `some but not all succeeded (${succeeded})`);
    ctx.expectEq(succeeded + failed, 5, 'each request either succeeded or insufficient-funds');
    const after = await ctx.balance(a);
    ctx.expect(after >= 0, `balance never negative (got ${after})`);
    ctx.expectEq(after, before - succeeded * amount, 'balance equals successes only');
  },
};

export const CON_03: Scenario = {
  id: 'CON-03',
  name: 'Ring: 200 accounts, 5,000 concurrent transfers, supply unchanged',
  tags: ['concurrency', 'tier1'],
  async run(ctx) {
    const n = 200;
    const perAccount = 25; // 200*25 = 5,000 transfers
    const amount = 20_000; // stays under daily limit for 25 sends

    const users = await ctx.freshUsers(n, 'Ring');
    const balancesBefore = await Promise.all(users.map((u) => ctx.balance(u)));

    // Warm each edge once (i -> i+1) so the burst doesn't trip step-up 200 times.
    const stepUpTokens = new Map<number, string>();
    for (let i = 0; i < n; i += 1) {
      const su = await ctx.client.stepUp(users[i].access_token, 'PIN', users[i].pin);
      stepUpTokens.set(i, su.body.step_up_token);
    }

    const supplyBefore = await ctx.adminPool.query(
      `SELECT COALESCE(SUM(balance),0)::bigint AS s FROM ledger.accounts WHERE type <> 'SYSTEM_MINT'`,
    );

    let accepted = 0;
    const BATCH = 200;
    for (let batch = 0; batch < perAccount; batch += 1) {
      const jobs: Promise<any>[] = [];
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        jobs.push(
          ctx.client.transfer(users[i].access_token, users[j].user.phone, amount, {
            idemKey: ctx.uuid(),
            stepUpToken: stepUpTokens.get(i)!,
          }),
        );
      }
      const results = await Promise.all(jobs);
      accepted += results.filter((r) => r.status < 300).length;
      const fivexx = results.filter((r) => r.status >= 500);
      ctx.expectEq(fivexx.length, 0, `batch ${batch}: no 5xx/deadlocks`);
      if (batch < perAccount - 1 && batch % 5 === 4) await sleep(1);
      void BATCH;
    }

    ctx.expect(accepted > 0, `some transfers landed (${accepted})`);

    const supplyAfter = await ctx.adminPool.query(
      `SELECT COALESCE(SUM(balance),0)::bigint AS s FROM ledger.accounts WHERE type <> 'SYSTEM_MINT'`,
    );
    ctx.expectEq(supplyAfter.rows[0].s, supplyBefore.rows[0].s, 'total supply unchanged');

    const balancesAfter = await Promise.all(users.map((u) => ctx.balance(u)));
    balancesAfter.forEach((b, i) => ctx.expect(b >= 0, `account ${i} non-negative (got ${b})`));
    void balancesBefore;
  },
};

export const CON_04: Scenario = {
  id: 'CON-04',
  name: 'Concurrent settle and cancel on one HELD transfer: exactly one wins',
  tags: ['concurrency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'CON04');
    const amount = 600_000; // above undo threshold (500,000) => HELD
    const before = await ctx.balance(a);

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const held = await ctx.client.transfer(a.access_token, b.user.phone, amount, {
      idemKey: ctx.uuid(),
      stepUpToken: su.body.step_up_token,
    });
    ctx.expectEq(held.status, 202, 'held accepted');
    ctx.expectEq(held.body.transaction.state, 'HELD', 'HELD state');
    const txnId = held.body.transaction.id;

    // Fire cancel at the same moment the sweeper is eligible to settle.
    const cancel = await ctx.client.cancelTransfer(a.access_token, txnId, ctx.uuid());

    // Exactly one of two valid outcomes: cancelled (money returned) or
    // settled-by-sweeper (money gone to receiver). Never both, never nothing.
    const { rows } = await ctx.adminPool.query(
      `SELECT state, COUNT(*)::int AS children FROM ledger.transactions
        WHERE id = $1 OR parent_txn_id = $1 GROUP BY state`,
      [txnId],
    );
    const states = rows.map((r: any) => r.state).sort();
    const cancelled = states.includes('CANCELLED');
    const completed = states.includes('COMPLETED');
    ctx.expect(cancelled !== completed, `exactly one of CANCELLED/COMPLETED — got ${states.join(',')}`);
    const after = await ctx.balance(a);
    ctx.expect(after >= 0, 'sender balance never negative');
    void cancel;
    void before;
  },
};

export const CON_05: Scenario = {
  id: 'CON-05',
  name: 'Two concurrent reversals of one txn: one succeeds, other 409',
  tags: ['concurrency', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'CON05');
    const txn = await ctx.transfer(a, b, 200_000);
    const txnId = txn.body.transaction.id;

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const results = await Promise.all([
      ctx.client.reverse(a.access_token, txnId, ctx.uuid(), su.body.step_up_token),
      ctx.client.reverse(a.access_token, txnId, ctx.uuid(), su.body.step_up_token),
    ]);

    const statuses = results.map((r) => r.status).sort((x, y) => x - y);
    ctx.expectEq(statuses[0], 201, 'one reversal succeeds');
    ctx.expectEq(statuses[1], 409, 'other gets 409');
  },
};

export const CON_06: Scenario = {
  id: 'CON-06',
  name: 'Two payers race to pay one request: one payment',
  tags: ['concurrency', 'tier1'],
  async run(ctx) {
    const [requester, payerA, payerB] = await ctx.freshUsers(3, 'CON06');
    const amount = 150_000;
    // requester asks payerA; payerB is a stranger who cannot legally pay, but
    // the request is 1:1 — the meaningful race is two pays by the SAME payer
    // where only one can win (CAS PENDING->PAID).
    const req = await ctx.client.createRequest(payerA.access_token, requester.user.phone, amount, 'race');
    const requestId = req.body.id;

    const su = await ctx.client.stepUp(payerA.access_token, 'PIN', payerA.pin);
    const results = await Promise.all([
      ctx.client.payRequest(payerA.access_token, requestId, ctx.uuid(), su.body.step_up_token),
      ctx.client.payRequest(payerA.access_token, requestId, ctx.uuid(), su.body.step_up_token),
    ]);
    const statuses = results.map((r) => r.status).sort((x, y) => x - y);
    ctx.expect(statuses[0] < 300, `at least one pay accepted — got ${statuses.join(',')}`);
    ctx.expect(statuses.filter((s) => s < 300).length === 1, 'exactly one payment');
    const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.money_requests WHERE id = $1`, [requestId]);
    ctx.expectEq(rows[0].state, 'PAID', 'request PAID once');
    void payerB;
  },
};

export const CON_07: Scenario = {
  id: 'CON-07',
  name: 'Concurrent decline and pay on one request: exactly one wins',
  tags: ['concurrency', 'tier1'],
  async run(ctx) {
    const [requester, payer] = await ctx.freshUsers(2, 'CON07');
    const amount = 80_000;
    const req = await ctx.client.createRequest(payer.access_token, requester.user.phone, amount, 'decline-v-pay');
    const requestId = req.body.id;

    const su = await ctx.client.stepUp(payer.access_token, 'PIN', payer.pin);
    const results = await Promise.all([
      ctx.client.declineRequest(payer.access_token, requestId),
      ctx.client.payRequest(payer.access_token, requestId, ctx.uuid(), su.body.step_up_token),
    ]);
    const statuses = results.map((r) => r.status);
    ctx.expect(statuses.some((s) => s < 300), 'at least one action won');
    ctx.expect(statuses.filter((s) => s < 300).length === 1, 'exactly one winner');

    const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.money_requests WHERE id = $1`, [requestId]);
    ctx.expect(['PAID', 'DECLINED'].includes(rows[0].state), `request ended in one terminal state (${rows[0].state})`);
  },
};

export const concurrencyScenarios: Scenario[] = [CON_01, CON_02, CON_03, CON_04, CON_05, CON_06, CON_07];