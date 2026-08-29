import { Scenario } from '../harness/types';

/**
 * HOLD / UNDO — SIMULATOR.md §4, Tier 2. The showpiece. Above the undo
 * threshold (৳5,000) a transfer is HELD; money leaves the sender into a HOLD
 * account immediately. These run fast because apps/api/.env sets
 * UNDO_WINDOW_SECONDS=3 / SWEEPER_INTERVAL_MS=250 (SIMULATOR.md §3.4).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const HLD_01: Scenario = {
  id: 'HLD-01',
  name: 'Above threshold: 202 HELD, sender debited immediately, receiver not yet credited',
  tags: ['hold', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HLD01');
    const amount = 600_000; // > 500,000 undo threshold
    const beforeA = await ctx.balance(a);
    const beforeB = await ctx.balance(b);

    const res = await ctx.transfer(a, b, amount);
    ctx.expectEq(res.status, 202, '202 Accepted');
    ctx.expectEq(res.body.transaction.state, 'HELD', 'HELD state');
    ctx.expect(!!res.body.can_cancel_until, 'can_cancel_until present');
    ctx.expectEq(await ctx.balance(a), beforeA - amount, 'sender debited immediately');
    ctx.expectEq(await ctx.balance(b), beforeB, 'receiver not yet credited');

    // Cancel to clean up so the sweeper doesn't settle this later.
    const id = res.body.transaction.id;
    await ctx.client.cancelTransfer(a.access_token, id, ctx.uuid());
  },
};

export const HLD_02: Scenario = {
  id: 'HLD-02',
  name: 'Cancel inside window: sender refunded, conserved at every instant',
  tags: ['hold', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HLD02');
    const amount = 700_000;
    const beforeA = await ctx.balance(a);

    const held = await ctx.transfer(a, b, amount);
    const txnId = held.body.transaction.id;

    const cancel = await ctx.client.cancelTransfer(a.access_token, txnId, ctx.uuid());
    ctx.expectEq(cancel.status, 200, 'cancel inside window');
    ctx.expectEq(await ctx.balance(a), beforeA, 'sender fully refunded');

    const { rows } = await ctx.adminPool.query(
      `SELECT state FROM ledger.transactions WHERE id = $1 OR parent_txn_id = $1 ORDER BY id`,
      [txnId],
    );
    const states = rows.map((r: any) => r.state).sort();
    ctx.expect(states.includes('CANCELLED'), `original cancelled (got ${states.join(',')})`);
  },
};

export const HLD_03: Scenario = {
  id: 'HLD-03',
  name: 'Sweeper settles after window: receiver credited',
  tags: ['hold', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HLD03');
    const amount = 650_000;
    const beforeB = await ctx.balance(b);

    const held = await ctx.transfer(a, b, amount);
    const txnId = held.body.transaction.id;

    // Window is 3s; sweeper runs every 250ms. Wait for the settle.
    let settled = false;
    for (let i = 0; i < 30; i += 1) {
      await sleep(250);
      const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.transactions WHERE id = $1`, [txnId]);
      if (rows[0]?.state === 'COMPLETED') {
        settled = true;
        break;
      }
    }
    ctx.expect(settled, 'sweeper settled the held transfer');
    ctx.expectEq(await ctx.balance(b), beforeB + amount, 'receiver credited after settle');
  },
};

export const HLD_04: Scenario = {
  id: 'HLD-04',
  name: 'Cancel after settle: 409 INVALID_STATE',
  tags: ['hold', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HLD04');
    const amount = 600_000;

    const held = await ctx.transfer(a, b, amount);
    const txnId = held.body.transaction.id;

    // Wait for the sweeper to settle (same loop as HLD-03).
    let settled = false;
    for (let i = 0; i < 30; i += 1) {
      await sleep(250);
      const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.transactions WHERE id = $1`, [txnId]);
      if (rows[0]?.state === 'COMPLETED') {
        settled = true;
        break;
      }
    }
    ctx.expect(settled, 'sweeper settled first');

    const cancel = await ctx.client.cancelTransfer(a.access_token, txnId, ctx.uuid());
    ctx.expectEq(cancel.status, 409, 'cancel after settle rejected');
    ctx.expectEq(cancel.body.error, 'INVALID_STATE', 'INVALID_STATE code');
  },
};

export const HLD_05: Scenario = {
  id: 'HLD-05',
  name: 'Held money cannot be double-spent — send the full balance while a hold is open: 402',
  tags: ['hold', 'tier2'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HLD05');
    const amount = 900_000; // leaves 9,100,000 available in the USER account
    const before = await ctx.balance(a);

    const held = await ctx.transfer(a, b, amount);
    ctx.expectEq(held.status, 202, 'held');

    // Now try to send the ORIGINAL full balance — impossible, because the
    // held 900,000 already left the USER account into HOLD.
    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const res = await ctx.client.transfer(a.access_token, b.user.phone, before, {
      idemKey: ctx.uuid(),
      stepUpToken: su.body.step_up_token,
    });
    ctx.expectEq(res.status, 402, 'cannot double-spend held money');
    ctx.expectEq(res.body.error, 'INSUFFICIENT_FUNDS', 'INSUFFICIENT_FUNDS');

    // Clean up: cancel the hold so this user's balance returns to normal.
    await ctx.client.cancelTransfer(a.access_token, held.body.transaction.id, ctx.uuid());
  },
};

export const holdScenarios: Scenario[] = [HLD_01, HLD_02, HLD_03, HLD_04, HLD_05];