import { Scenario } from '../harness/types';

/**
 * SEND MONEY TO A GROUP — SIMULATOR.md / EXTRA_FEATURES_AUDIT_AND_DESIGN.md §3.
 * One sender pays several recipients in one action. Each recipient payment succeeds
 * or fails independently. Temporary/permanent failures refund safely.
 */

export const GRP_01: Scenario = {
  id: 'GRP-01',
  name: 'All recipients valid: batch COMPLETED, all 3 recipients credited, total debited',
  tags: ['group', 'group-payments', 'tier1'],
  async run(ctx) {
    const [sender, r1, r2, r3] = await ctx.freshUsers(4, 'GRP01');
    const beforeSender = await ctx.balance(sender);
    const beforeR1 = await ctx.balance(r1);
    const beforeR2 = await ctx.balance(r2);
    const beforeR3 = await ctx.balance(r3);

    const su = await ctx.client.stepUp(sender.access_token, 'PIN', sender.pin);
    const res = await ctx.client.createGroupTransfer(
      sender.access_token,
      [
        { phone: r1.user.phone, amount_paisa: 15_000 },
        { phone: r2.user.phone, amount_paisa: 25_000 },
        { phone: r3.user.phone, amount_paisa: 35_000 },
      ],
      { title: 'Project Bonuses', idemKey: ctx.uuid(), stepUpToken: su.body.step_up_token },
    );

    ctx.expectEq(res.status, 201, 'group transfer created');
    ctx.expectEq(res.body.batch.state, 'COMPLETED', 'batch state COMPLETED');
    ctx.expectEq(res.body.batch.total_amount_paisa, 75_000, 'total amount 75,000');
    ctx.expectEq(res.body.batch.success_count, 3, 'all 3 succeeded');
    ctx.expectEq(res.body.batch.refund_count, 0, '0 refunds');
    ctx.expectEq(res.body.items.length, 3, '3 items processed');

    ctx.expectEq(await ctx.balance(r1), beforeR1 + 15_000, 'r1 credited 15,000');
    ctx.expectEq(await ctx.balance(r2), beforeR2 + 25_000, 'r2 credited 25,000');
    ctx.expectEq(await ctx.balance(r3), beforeR3 + 35_000, 'r3 credited 35,000');
    ctx.expectEq(await ctx.balance(sender), beforeSender - 75_000, 'sender debited full 75,000');
  },
};

export const GRP_02: Scenario = {
  id: 'GRP-02',
  name: 'One recipient invalid/nonexistent: 2 succeed, 1 refunded, batch PARTIALLY_COMPLETED',
  tags: ['group', 'group-payments', 'tier1'],
  async run(ctx) {
    const [sender, r1, r2] = await ctx.freshUsers(3, 'GRP02');
    const beforeSender = await ctx.balance(sender);
    const beforeR1 = await ctx.balance(r1);
    const beforeR2 = await ctx.balance(r2);

    const su = await ctx.client.stepUp(sender.access_token, 'PIN', sender.pin);
    const res = await ctx.client.createGroupTransfer(
      sender.access_token,
      [
        { phone: r1.user.phone, amount_paisa: 20_000 },
        { phone: '+8801799999999', amount_paisa: 30_000 }, // Nonexistent user
        { phone: r2.user.phone, amount_paisa: 40_000 },
      ],
      { title: 'Partial Group Pay', idemKey: ctx.uuid(), stepUpToken: su.body.step_up_token },
    );

    ctx.expectEq(res.status, 201, 'group transfer created');
    ctx.expectEq(res.body.batch.state, 'PARTIALLY_COMPLETED', 'state PARTIALLY_COMPLETED');
    ctx.expectEq(res.body.batch.success_count, 2, '2 successes');
    ctx.expectEq(res.body.batch.refund_count, 1, '1 refunded');

    ctx.expectEq(await ctx.balance(r1), beforeR1 + 20_000, 'r1 credited 20,000');
    ctx.expectEq(await ctx.balance(r2), beforeR2 + 40_000, 'r2 credited 40,000');
    // Sender only paid 20,000 + 40,000 = 60,000 (30,000 refunded back to sender)
    ctx.expectEq(await ctx.balance(sender), beforeSender - 60_000, 'sender net debited 60,000');
  },
};

export const GRP_03: Scenario = {
  id: 'GRP-03',
  name: 'Insufficient funds for group total: 402 INSUFFICIENT_FUNDS, all-or-nothing hold fails',
  tags: ['group', 'group-payments', 'tier1'],
  async run(ctx) {
    const [sender, r1, r2] = await ctx.freshUsers(3, 'GRP03');
    const senderBal = await ctx.balance(sender);

    const su = await ctx.client.stepUp(sender.access_token, 'PIN', sender.pin);
    const res = await ctx.client.createGroupTransfer(
      sender.access_token,
      [
        { phone: r1.user.phone, amount_paisa: senderBal },
        { phone: r2.user.phone, amount_paisa: senderBal },
      ],
      { title: 'Overdraft Group', idemKey: ctx.uuid(), stepUpToken: su.body.step_up_token },
    );

    ctx.expectEq(res.status, 402, '402 INSUFFICIENT_FUNDS');
    ctx.expectEq(await ctx.balance(sender), senderBal, 'sender balance unchanged');
  },
};

export const groupScenarios: Scenario[] = [GRP_01, GRP_02, GRP_03];
