import { Scenario } from '../harness/types';

/**
 * SHARED BILL PAYMENT — the multi-payer feature (Antigravity Round 1). One
 * bill, several payers, each settling their own share from their own normal
 * account; the bill flips to SETTLED once every share is paid.
 */

export const BILL_01: Scenario = {
  id: 'BILL-01',
  name: 'Create a bill: computed total, all shares PENDING, no money moves',
  tags: ['bills', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL01');
    const before = await ctx.balance(creator);

    const res = await ctx.client.createBill(creator.access_token, 'Dinner', [
      { phone: p1.user.phone, amount_paisa: 40_000 },
      { phone: p2.user.phone, amount_paisa: 40_000 },
    ]);
    ctx.expectEq(res.status, 201, 'bill created');
    ctx.expectEq(res.body.state, 'OPEN', 'OPEN');
    ctx.expectEq(res.body.total_amount_paisa, 80_000, 'total computed');
    ctx.expectEq(res.body.shares.length, 2, 'two shares');
    ctx.expect(res.body.shares.every((s: any) => s.state === 'PENDING'), 'all shares PENDING');
    ctx.expectEq(await ctx.balance(creator), before, 'no money moved');
  },
};

export const BILL_02: Scenario = {
  id: 'BILL-02',
  name: 'Pay my share settles from my own balance and CASes share to PAID',
  tags: ['bills', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL02');
    const bill = await ctx.client.createBill(creator.access_token, 'Kacchi', [
      { phone: p1.user.phone, amount_paisa: 50_000 },
      { phone: p2.user.phone, amount_paisa: 50_000 },
    ]);
    const billId = bill.body.id;
    const beforeP1 = await ctx.balance(p1);
    const beforeCreator = await ctx.balance(creator);

    const su = await ctx.client.stepUp(p1.access_token, 'PIN', p1.pin);
    const paid = await ctx.client.payBill(p1.access_token, billId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(paid.status, 200, 'share paid');
    ctx.expectEq(paid.body.transaction.kind, 'BILL_SHARE_SETTLE', 'settlement kind');
    ctx.expectEq(await ctx.balance(p1), beforeP1 - 50_000, 'payer debited');
    ctx.expectEq(await ctx.balance(creator), beforeCreator + 50_000, 'creator credited');
    ctx.expectEq(paid.body.bill.state, 'OPEN', 'bill still OPEN (one share left)');

    const detail = await ctx.client.getBill(creator.access_token, billId);
    const shares = detail.body.shares;
    ctx.expectEq(shares.find((s: any) => s.payer.id === p1.user.id)?.state, 'PAID', 'share PAID');
    ctx.expectEq(shares.find((s: any) => s.payer.id === p2.user.id)?.state, 'PENDING', 'other share PENDING');
  },
};

export const BILL_03: Scenario = {
  id: 'BILL-03',
  name: 'Bill settles the moment every share is paid',
  tags: ['bills', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL03');
    const bill = await ctx.client.createBill(creator.access_token, 'Trip', [
      { phone: p1.user.phone, amount_paisa: 30_000 },
      { phone: p2.user.phone, amount_paisa: 30_000 },
    ]);
    const billId = bill.body.id;

    const su1 = await ctx.client.stepUp(p1.access_token, 'PIN', p1.pin);
    const su2 = await ctx.client.stepUp(p2.access_token, 'PIN', p2.pin);
    await ctx.client.payBill(p1.access_token, billId, ctx.uuid(), su1.body.step_up_token);
    const last = await ctx.client.payBill(p2.access_token, billId, ctx.uuid(), su2.body.step_up_token);
    ctx.expectEq(last.body.bill.state, 'SETTLED', 'bill SETTLED on last share');
  },
};

export const BILL_04: Scenario = {
  id: 'BILL-04',
  name: 'Cannot pay someone else\'s share — 404 BILL_SHARE_NOT_FOUND',
  tags: ['bills', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2, stranger] = await ctx.freshUsers(4, 'BILL04');
    const bill = await ctx.client.createBill(creator.access_token, 'Split', [
      { phone: p1.user.phone, amount_paisa: 20_000 },
      { phone: p2.user.phone, amount_paisa: 20_000 },
    ]);
    const billId = bill.body.id;

    const su = await ctx.client.stepUp(stranger.access_token, 'PIN', stranger.pin);
    const res = await ctx.client.payBill(stranger.access_token, billId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(res.status, 404, 'stranger has no share');
    ctx.expectEq(res.body.error, 'BILL_SHARE_NOT_FOUND', 'BILL_SHARE_NOT_FOUND');
  },
};

export const BILL_05: Scenario = {
  id: 'BILL-05',
  name: 'Paying an already-paid share: 409 INVALID_STATE',
  tags: ['bills', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL05');
    const bill = await ctx.client.createBill(creator.access_token, 'Dup', [
      { phone: p1.user.phone, amount_paisa: 25_000 },
      { phone: p2.user.phone, amount_paisa: 25_000 },
    ]);
    const billId = bill.body.id;

    const su = await ctx.client.stepUp(p1.access_token, 'PIN', p1.pin);
    const first = await ctx.client.payBill(p1.access_token, billId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(first.status, 200, 'first pay ok');
    const second = await ctx.client.payBill(p1.access_token, billId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(second.status, 409, 'second pay blocked');
    ctx.expectEq(second.body.error, 'INVALID_STATE', 'INVALID_STATE');
  },
};

export const billsScenarios: Scenario[] = [BILL_01, BILL_02, BILL_03, BILL_04, BILL_05];