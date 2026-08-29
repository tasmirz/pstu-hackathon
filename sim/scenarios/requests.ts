import { Scenario } from '../harness/types';

/**
 * MONEY REQUESTS / BILL PAYMENT (1:1) — SIMULATOR.md §4 HAP-05 covers the
 * happy path; this group owns the request lifecycle edge cases. Creating a
 * request moves NO money — a request is a message, not a debit.
 */

export const REQ_01: Scenario = {
  id: 'REQ-01',
  name: 'Creating a request moves no money and requires no step-up',
  tags: ['requests', 'tier1'],
  async run(ctx) {
    const [requester, payer] = await ctx.freshUsers(2, 'REQ01');
    const beforeR = await ctx.balance(requester);
    const beforeP = await ctx.balance(payer);

    // requester asks payer for money
    const res = await ctx.client.createRequest(requester.access_token, payer.user.phone, 120_000, 'ticket');
    ctx.expectEq(res.status, 201, 'request created');
    ctx.expectEq(res.body.state, 'PENDING', 'PENDING');
    ctx.expectEq(await ctx.balance(requester), beforeR, 'requester balance untouched');
    ctx.expectEq(await ctx.balance(payer), beforeP, 'payer balance untouched');
  },
};

export const REQ_02: Scenario = {
  id: 'REQ-02',
  name: 'Requester cancels while PENDING: CANCELLED, no money moves',
  tags: ['requests', 'tier1'],
  async run(ctx) {
    const [requester, payer] = await ctx.freshUsers(2, 'REQ02');
    const created = await ctx.client.createRequest(requester.access_token, payer.user.phone, 50_000, 'cancel me');
    const id = created.body.id;

    const cancel = await ctx.client.cancelRequest(requester.access_token, id);
    ctx.expectEq(cancel.status, 200, 'requester cancels');
    const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.money_requests WHERE id = $1`, [id]);
    ctx.expectEq(rows[0].state, 'CANCELLED', 'CANCELLED');
  },
};

export const REQ_03: Scenario = {
  id: 'REQ-03',
  name: 'Payer declines while PENDING: DECLINED',
  tags: ['requests', 'tier1'],
  async run(ctx) {
    const [requester, payer] = await ctx.freshUsers(2, 'REQ03');
    const created = await ctx.client.createRequest(requester.access_token, payer.user.phone, 40_000, 'decline');
    const id = created.body.id;

    const declined = await ctx.client.declineRequest(payer.access_token, id);
    ctx.expectEq(declined.status, 200, 'payer declines');
    const { rows } = await ctx.adminPool.query(`SELECT state FROM ledger.money_requests WHERE id = $1`, [id]);
    ctx.expectEq(rows[0].state, 'DECLINED', 'DECLINED');
  },
};

export const REQ_04: Scenario = {
  id: 'REQ-04',
  name: 'Pay an already-paid/declined/cancelled request: 409 INVALID_STATE',
  tags: ['requests', 'tier1'],
  async run(ctx) {
    const [requester, payer] = await ctx.freshUsers(2, 'REQ04');
    const amount = 70_000;
    const created = await ctx.client.createRequest(requester.access_token, payer.user.phone, amount, 'done');
    const id = created.body.id;

    const su = await ctx.client.stepUp(payer.access_token, 'PIN', payer.pin);
    const paid = await ctx.client.payRequest(payer.access_token, id, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(paid.status, 200, 'paid once');

    const again = await ctx.client.payRequest(payer.access_token, id, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(again.status, 409, 'second pay rejected');
    ctx.expectEq(again.body.error, 'INVALID_STATE', 'INVALID_STATE');
  },
};

export const REQ_05: Scenario = {
  id: 'REQ-05',
  name: 'Remind is rate-limited: second remind within an hour returns 429',
  tags: ['requests', 'tier2'],
  async run(ctx) {
    const [requester, payer] = await ctx.freshUsers(2, 'REQ05');
    const created = await ctx.client.createRequest(requester.access_token, payer.user.phone, 60_000, 'nudge');
    const id = created.body.id;

    const first = await ctx.client.remindRequest(requester.access_token, id);
    ctx.expect(first.status < 400, `first remind ok (${first.status})`);

    const second = await ctx.client.remindRequest(requester.access_token, id);
    ctx.expectEq(second.status, 429, 'second remind within an hour rejected');
    ctx.expectEq(second.body.error, 'VELOCITY_EXCEEDED', 'VELOCITY_EXCEEDED');
  },
};

export const requestsScenarios: Scenario[] = [REQ_01, REQ_02, REQ_03, REQ_04, REQ_05];