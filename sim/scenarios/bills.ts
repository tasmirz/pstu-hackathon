import { Scenario } from '../harness/types';

/**
 * SHARED BILL PAYMENT — SIMULATOR.md §4 / TASKS_ANTIGRAVITY.md Round 4.
 * One bill, several payers, each settling their own share from their own normal
 * account; the bill flips to SETTLED once every share is paid.
 */

export const BILL_01: Scenario = {
  id: 'BILL-01',
  name: 'Create a 3-share bill: all 3 payers settle shares, bill auto-SETTLED on last share',
  tags: ['bills', 'bill', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2, p3] = await ctx.freshUsers(4, 'BILL01');
    const beforeCreator = await ctx.balance(creator);
    const beforeP1 = await ctx.balance(p1);
    const beforeP2 = await ctx.balance(p2);
    const beforeP3 = await ctx.balance(p3);

    const res = await ctx.client.createBill(creator.access_token, 'Team Dinner', [
      { phone: p1.user.phone, amount_paisa: 30_000 },
      { phone: p2.user.phone, amount_paisa: 40_000 },
      { phone: p3.user.phone, amount_paisa: 50_000 },
    ]);
    ctx.expectEq(res.status, 201, 'bill created');
    ctx.expectEq(res.body.state, 'OPEN', 'OPEN');
    ctx.expectEq(res.body.total_amount_paisa, 120_000, 'total computed');
    ctx.expectEq(res.body.shares.length, 3, 'three shares');
    ctx.expect(res.body.shares.every((s: any) => s.state === 'PENDING'), 'all shares PENDING');
    ctx.expectEq(await ctx.balance(creator), beforeCreator, 'no money moved on creation');

    const billId = res.body.id;

    // P1 pays share (with step-up if first-time)
    let pay1 = await ctx.client.payBill(p1.access_token, billId, ctx.uuid());
    if (pay1.status === 403 && pay1.body?.error === 'STEP_UP_REQUIRED') {
      const su1 = await ctx.client.stepUp(p1.access_token, 'PIN', p1.pin);
      pay1 = await ctx.client.payBill(p1.access_token, billId, ctx.uuid(), su1.body.step_up_token);
    }
    ctx.expectEq(pay1.status, 200, 'p1 paid');
    ctx.expectEq(pay1.body.bill.state, 'OPEN', 'bill still OPEN after 1st share');
    ctx.expectEq(await ctx.balance(p1), beforeP1 - 30_000, 'p1 debited 30,000');

    // P2 pays share
    let pay2 = await ctx.client.payBill(p2.access_token, billId, ctx.uuid());
    if (pay2.status === 403 && pay2.body?.error === 'STEP_UP_REQUIRED') {
      const su2 = await ctx.client.stepUp(p2.access_token, 'PIN', p2.pin);
      pay2 = await ctx.client.payBill(p2.access_token, billId, ctx.uuid(), su2.body.step_up_token);
    }
    ctx.expectEq(pay2.status, 200, 'p2 paid');
    ctx.expectEq(pay2.body.bill.state, 'OPEN', 'bill still OPEN after 2nd share');
    ctx.expectEq(await ctx.balance(p2), beforeP2 - 40_000, 'p2 debited 40,000');

    // P3 pays last share -> bill auto-settles to SETTLED
    let pay3 = await ctx.client.payBill(p3.access_token, billId, ctx.uuid());
    if (pay3.status === 403 && pay3.body?.error === 'STEP_UP_REQUIRED') {
      const su3 = await ctx.client.stepUp(p3.access_token, 'PIN', p3.pin);
      pay3 = await ctx.client.payBill(p3.access_token, billId, ctx.uuid(), su3.body.step_up_token);
    }
    ctx.expectEq(pay3.status, 200, 'p3 paid');
    ctx.expectEq(pay3.body.bill.state, 'SETTLED', 'bill auto-SETTLED on last share');
    ctx.expectEq(await ctx.balance(p3), beforeP3 - 50_000, 'p3 debited 50,000');
    ctx.expectEq(await ctx.balance(creator), beforeCreator + 120_000, 'creator credited full total');
  },
};

export const BILL_02: Scenario = {
  id: 'BILL-02',
  name: 'Creator in shares: 422 SELF_TRANSFER',
  tags: ['bills', 'bill', 'tier1'],
  async run(ctx) {
    const [creator, p1] = await ctx.freshUsers(2, 'BILL02');
    const res = await ctx.client.createBill(creator.access_token, 'Self Bill', [
      { phone: creator.user.phone, amount_paisa: 50_000 },
      { phone: p1.user.phone, amount_paisa: 50_000 },
    ]);
    ctx.expectEq(res.status, 422, 'creator in shares rejected');
    ctx.expectEq(res.body.error, 'SELF_TRANSFER', 'SELF_TRANSFER');
  },
};

export const BILL_03: Scenario = {
  id: 'BILL-03',
  name: 'Cannot pay someone else\'s share — 404 BILL_SHARE_NOT_FOUND',
  tags: ['bills', 'bill', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2, stranger] = await ctx.freshUsers(4, 'BILL03');
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

export const BILL_04: Scenario = {
  id: 'BILL-04',
  name: 'Cancel bill before any share paid succeeds; cancel after share paid rejected with 409 INVALID_STATE',
  tags: ['bills', 'bill', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL04');

    // 1. Cancel unstarted bill -> succeeds
    const bill1 = await ctx.client.createBill(creator.access_token, 'To Cancel', [
      { phone: p1.user.phone, amount_paisa: 25_000 },
      { phone: p2.user.phone, amount_paisa: 25_000 },
    ]);
    const cancel1 = await ctx.client.cancelBill(creator.access_token, bill1.body.id);
    ctx.expectEq(cancel1.status, 200, 'unstarted bill cancelled');
    ctx.expectEq(cancel1.body.bill.state, 'CANCELLED', 'CANCELLED');

    // 2. Bill with 1 paid share cannot be cancelled -> 409 INVALID_STATE
    const bill2 = await ctx.client.createBill(creator.access_token, 'Partially Paid', [
      { phone: p1.user.phone, amount_paisa: 35_000 },
      { phone: p2.user.phone, amount_paisa: 35_000 },
    ]);
    const su = await ctx.client.stepUp(p1.access_token, 'PIN', p1.pin);
    await ctx.client.payBill(p1.access_token, bill2.body.id, ctx.uuid(), su.body.step_up_token);

    const cancel2 = await ctx.client.cancelBill(creator.access_token, bill2.body.id);
    ctx.expectEq(cancel2.status, 409, 'partially paid bill cancel blocked');
    ctx.expectEq(cancel2.body.error, 'INVALID_STATE', 'INVALID_STATE');
  },
};

export const BILL_05: Scenario = {
  id: 'BILL-05',
  name: 'Paying an already-paid share: 409 INVALID_STATE',
  tags: ['bills', 'bill', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL05');
    const bill = await ctx.client.createBill(creator.access_token, 'Dup Pay', [
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

export const BILL_06: Scenario = {
  id: 'BILL-06',
  name: 'Equal split: 3 participants, 10,000 paisa -> 3334, 3333, 3333, sum exactly matches total',
  tags: ['bills', 'bill', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2, p3] = await ctx.freshUsers(4, 'BILL06');
    const res = await ctx.client.createBill(
      creator.access_token,
      'Dinner Split 3-way',
      [{ phone: p1.user.phone }, { phone: p2.user.phone }, { phone: p3.user.phone }],
      { split_mode: 'EQUAL', total_amount_paisa: 10_000 },
    );
    ctx.expectEq(res.status, 201, 'equal split bill created');
    ctx.expectEq(res.body.split_mode, 'EQUAL', 'split_mode is EQUAL');
    ctx.expectEq(res.body.total_amount_paisa, 10_000, 'total is 10,000');
    ctx.expectEq(res.body.shares.length, 3, 'three shares created');

    const amounts = res.body.shares.map((s: any) => s.amount_paisa);
    ctx.expectEq(amounts[0], 3334, 'first share gets remainder: 3334');
    ctx.expectEq(amounts[1], 3333, 'second share: 3333');
    ctx.expectEq(amounts[2], 3333, 'third share: 3333');
    const sum = amounts.reduce((a: number, b: number) => a + b, 0);
    ctx.expectEq(sum, 10_000, 'sum matches total perfectly');
  },
};

export const BILL_07: Scenario = {
  id: 'BILL-07',
  name: 'Concurrent race to pay the last 50,000 paisa of a share: exactly one succeeds',
  tags: ['bills', 'bill', 'concurrency', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL07');
    const bill = await ctx.client.createBill(creator.access_token, 'Race Share', [
      { phone: p1.user.phone, amount_paisa: 50_000 },
      { phone: p2.user.phone, amount_paisa: 50_000 },
    ]);
    const billId = bill.body.id;
    const su = await ctx.client.stepUp(p1.access_token, 'PIN', p1.pin);

    // Two parallel requests attempting to pay p1's share with different idempotency keys
    const [r1, r2] = await Promise.all([
      ctx.client.payBill(p1.access_token, billId, ctx.uuid(), su.body.step_up_token),
      ctx.client.payBill(p1.access_token, billId, ctx.uuid(), su.body.step_up_token),
    ]);

    const statuses = [r1.status, r2.status].sort();
    ctx.expectEq(statuses[0], 200, 'exactly one payment succeeded');
    ctx.expectEq(statuses[1], 409, 'the other payment rejected with 409 INVALID_STATE');
  },
};

export const BILL_08: Scenario = {
  id: 'BILL-08',
  name: 'Safe partial payment: pay 60% -> PARTIALLY_PAID, pay 40% -> PAID, bill auto-SETTLED',
  tags: ['bills', 'bill', 'tier1'],
  async run(ctx) {
    const [creator, p1, p2] = await ctx.freshUsers(3, 'BILL08');
    const beforeCreator = await ctx.balance(creator);
    const beforeP1 = await ctx.balance(p1);

    const bill = await ctx.client.createBill(creator.access_token, 'Installment Bill', [
      { phone: p1.user.phone, amount_paisa: 100_000 },
      { phone: p2.user.phone, amount_paisa: 100_000 },
    ]);
    const billId = bill.body.id;

    // 1. P2 pays their share in full
    const su2 = await ctx.client.stepUp(p2.access_token, 'PIN', p2.pin);
    await ctx.client.payBill(p2.access_token, billId, ctx.uuid(), su2.body.step_up_token);

    // 2. P1 pays 60% (60,000 paisa)
    const su1 = await ctx.client.stepUp(p1.access_token, 'PIN', p1.pin);
    const payPart1 = await ctx.client.payBill(
      p1.access_token,
      billId,
      ctx.uuid(),
      su1.body.step_up_token,
      60_000,
    );
    ctx.expectEq(payPart1.status, 200, 'partial payment 60% ok');
    ctx.expectEq(payPart1.body.share.state, 'PARTIALLY_PAID', 'share is PARTIALLY_PAID');
    ctx.expectEq(payPart1.body.share.paid_amount_paisa, 60_000, 'paid is 60,000');
    ctx.expectEq(payPart1.body.share.remaining_paisa, 40_000, 'remaining is 40,000');
    ctx.expectEq(payPart1.body.bill.state, 'OPEN', 'bill still OPEN');
    ctx.expectEq(await ctx.balance(p1), beforeP1 - 60_000, 'p1 debited 60,000');

    // 3. P1 tries to overpay by paying 50,000 (when only 40,000 remains) -> rejected
    const overpay = await ctx.client.payBill(
      p1.access_token,
      billId,
      ctx.uuid(),
      su1.body.step_up_token,
      50_000,
    );
    ctx.expect([400, 422].includes(overpay.status), 'overpayment rejected');

    // 4. P1 pays remaining 40,000 -> share becomes PAID, bill becomes SETTLED
    const payPart2 = await ctx.client.payBill(
      p1.access_token,
      billId,
      ctx.uuid(),
      su1.body.step_up_token,
      40_000,
    );
    ctx.expectEq(payPart2.status, 200, 'second payment 40% ok');
    ctx.expectEq(payPart2.body.share.state, 'PAID', 'share is now PAID');
    ctx.expectEq(payPart2.body.bill.state, 'SETTLED', 'bill is now SETTLED');
    ctx.expectEq(await ctx.balance(p1), beforeP1 - 100_000, 'p1 debited full 100,000');
    ctx.expectEq(await ctx.balance(creator), beforeCreator + 200_000, 'creator credited full total');
  },
};

export const billsScenarios: Scenario[] = [
  BILL_01,
  BILL_02,
  BILL_03,
  BILL_04,
  BILL_05,
  BILL_06,
  BILL_07,
  BILL_08,
];
export const billScenarios: Scenario[] = billsScenarios;