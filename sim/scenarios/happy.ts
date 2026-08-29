import { Scenario } from '../harness/types';

/**
 * HAPPY PATH — SIMULATOR.md §4, Tier 1. These run against the live API via
 * the typed client in harness/client.ts. `ctx.transfer` auto-fetches a PIN
 * step-up token when the API asks for one (first-time recipient), so happy
 * paths read like product behaviour, not plumbing.
 */

const BONUS = 10_000_000; // ৳100,000 — config.signupBonusPaisa

export const HAP_01: Scenario = {
  id: 'HAP-01',
  name: 'Register mints exactly Tk 100,000 from SYSTEM_MINT as a real 2-leg txn',
  tags: ['happy', 'tier1'],
  async run(ctx) {
    const u = await ctx.freshUser('Bonus Check');
    ctx.expectEq(u.balance_paisa, BONUS, 'signup balance');
    ctx.expectEq(u.signup_bonus_paisa, BONUS, 'signup bonus paisa');
    ctx.expectEq(await ctx.balance(u), BONUS, 'balance via API');

    const { rows } = await ctx.adminPool.query(
      `SELECT t.kind, t.amount, e.amount AS leg, a.type AS account_type
         FROM ledger.transactions t
         JOIN ledger.entries e ON e.txn_id = t.id
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE t.receiver_id = $1 AND t.kind = 'SIGNUP_BONUS'
        ORDER BY e.id`,
      [u.user.id],
    );
    ctx.expectEq(rows.length, 2, 'exactly two legs');
    const sum = rows.reduce((acc: number, r: any) => acc + Number(r.leg), 0);
    ctx.expectEq(sum, 0, 'legs sum to zero');
    const types = rows.map((r: any) => r.account_type).sort();
    ctx.expect(
      types.includes('SYSTEM_MINT') && types.includes('USER'),
      `one leg from SYSTEM_MINT, one to USER — got ${types.join(', ')}`,
    );
  },
};

export const HAP_02: Scenario = {
  id: 'HAP-02',
  name: 'Transfer debits sender and credits receiver by the same amount',
  tags: ['happy', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HAP02');
    const amount = 250_000; // ৳2,500 — under the undo threshold
    const beforeA = await ctx.balance(a);
    const beforeB = await ctx.balance(b);

    const res = await ctx.transfer(a, b, amount, { note: 'HAP-02' });
    ctx.expectEq(res.status, 201, 'transfer accepted');
    ctx.expectEq(res.body.transaction.state, 'COMPLETED', 'immediate completion');
    ctx.expectEq(await ctx.balance(a), beforeA - amount, 'sender debited');
    ctx.expectEq(await ctx.balance(b), beforeB + amount, 'receiver credited');
    ctx.expectEq(res.body.balance_paisa, beforeA - amount, 'response carries new balance');
  },
};

export const HAP_03: Scenario = {
  id: 'HAP-03',
  name: 'Both parties see the transfer in history with correct direction',
  tags: ['happy', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HAP03');
    const amount = 100_000;
    await ctx.transfer(a, b, amount);

    const sent = await ctx.client.transactions(a.access_token, { direction: 'sent', limit: 10 });
    const received = await ctx.client.transactions(b.access_token, { direction: 'received', limit: 10 });
    ctx.expect(sent.status === 200 && received.status === 200, 'history readable for both');

    const sentRow = sent.body.items.find((i: any) => i.kind === 'TRANSFER' && i.amount_paisa === amount);
    const recvRow = received.body.items.find((i: any) => i.kind === 'TRANSFER' && i.amount_paisa === amount);
    ctx.expect(!!sentRow, 'sender sees it as sent');
    ctx.expect(!!recvRow, 'receiver sees it as received');
    ctx.expectEq(sentRow.counterparty.phone, b.user.phone, 'sender counterparty');
    ctx.expectEq(recvRow.counterparty.phone, a.user.phone, 'receiver counterparty');
  },
};

export const HAP_04: Scenario = {
  id: 'HAP-04',
  name: 'Transaction detail returns both legs, summing to zero',
  tags: ['happy', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'HAP04');
    const amount = 120_000;
    const txn = await ctx.transfer(a, b, amount);
    const id = txn.body.transaction.id;

    const detail = await ctx.client.transaction(a.access_token, id);
    ctx.expectEq(detail.status, 200, 'detail readable');
    const legs = detail.body.entries;
    ctx.expectEq(legs.length, 2, 'two ledger legs');
    const sum = legs.reduce((acc: number, e: any) => acc + e.amount_paisa, 0);
    ctx.expectEq(sum, 0, 'legs sum to zero');
    ctx.expectEq(detail.body.can_reverse, true, 'sender can reverse');
  },
};

export const HAP_05: Scenario = {
  id: 'HAP-05',
  name: 'Request then pay: requester credited, request state PAID',
  tags: ['happy', 'tier1'],
  async run(ctx) {
    const [requester, payer] = await ctx.freshUsers(2, 'HAP05'); // requester asks payer
    const amount = 120_000;
    const before = await ctx.balance(requester);

    // POST /money-requests is created by the requester (who gets paid);
    // `from_phone` names the payer (API.md "POST /money-requests").
    const created = await ctx.client.createRequest(requester.access_token, payer.user.phone, amount, 'for the ticket');
    ctx.expectEq(created.status, 201, 'request created');
    ctx.expectEq(created.body.state, 'PENDING', 'request starts PENDING');
    const requestId = created.body.id;

    // First payment between these two — pay() applies the same
    // FIRST_TIME_RECIPIENT step-up rule as a plain transfer.
    let paid = await ctx.client.payRequest(payer.access_token, requestId, ctx.uuid());
    if (paid.status === 403 && paid.body?.error === 'STEP_UP_REQUIRED') {
      const su = await ctx.client.stepUp(payer.access_token, 'PIN', payer.pin);
      paid = await ctx.client.payRequest(payer.access_token, requestId, ctx.uuid(), su.body.step_up_token);
    }
    ctx.expect([200, 201].includes(paid.status), 'payer approved');
    ctx.expectEq(paid.body.transaction.kind, 'REQUEST_SETTLE', 'settlement kind');
    ctx.expectEq(await ctx.balance(requester), before + amount, 'requester credited');

    const detail = await ctx.client.getBill(payer.access_token, requestId).catch(() => null);
    void detail;
    const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.money_requests WHERE id = $1`, [requestId]);
    ctx.expectEq(rows[0].state, 'PAID', 'request state PAID');
  },
};

export const HAP_06: Scenario = {
  id: 'HAP-06',
  name: 'SYSTEM_MINT is negative by exactly the total minted',
  tags: ['happy', 'tier1'],
  async run(ctx) {
    const before = await ctx.freshUser('Mint Before');
    void before;
    const u = await ctx.freshUser('Mint Check');

    const { rows } = await ctx.adminPool.query(`
      SELECT COALESCE(SUM(-e.amount), 0) AS minted
        FROM ledger.entries e
        JOIN ledger.accounts a ON a.id = e.account_id
       WHERE a.type = 'SYSTEM_MINT'
    `);
    const minted = Number(rows[0].minted);
    const { rows: mint } = await ctx.adminPool.query(
      `SELECT balance FROM ledger.accounts WHERE type = 'SYSTEM_MINT' LIMIT 1`,
    );
    ctx.expectEq(Number(mint[0].balance), -minted, 'SYSTEM_MINT equals negative of total minted');
    ctx.expect(minted > 0, 'something was minted');
    void u;
  },
};

export const happyScenarios: Scenario[] = [HAP_01, HAP_02, HAP_03, HAP_04, HAP_05, HAP_06];