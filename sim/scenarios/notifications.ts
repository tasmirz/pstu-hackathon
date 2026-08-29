import { Scenario } from '../harness/types';

export const NOTIF_01: Scenario = {
  id: 'NOTIF-01',
  name: 'Transfer generates TXN_SENT for sender and TXN_RECEIVED for receiver',
  tags: ['notifications', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'NOTIF01');
    const res = await ctx.transfer(a, b, 50_000); // ৳500.00
    ctx.expect(res.status === 200 || res.status === 201, 'transfer accepted');
    const txnId = res.body.transaction.id;

    const notifsA = await ctx.client.notifications(a.access_token);
    ctx.expectEq(notifsA.status, 200, 'a notifs status');
    ctx.expectEq(notifsA.body.items.length >= 1, true, 'a has notif');
    const sentNotif = notifsA.body.items.find((n: any) => n.txn_id === txnId);
    ctx.expectEq(Boolean(sentNotif), true, 'sent notif found');
    ctx.expectEq(sentNotif.kind, 'TXN_SENT', 'kind TXN_SENT');
    ctx.expectEq(sentNotif.title, 'Money Sent', 'title Money Sent');
    ctx.expectEq(sentNotif.body.includes('Sent ৳500.00'), true, 'body includes amount');
    ctx.expectEq(sentNotif.body.includes(b.user.name), true, 'body includes receiver name');
    ctx.expectEq(sentNotif.read_at, null, 'read_at is null');

    const notifsB = await ctx.client.notifications(b.access_token);
    ctx.expectEq(notifsB.status, 200, 'b notifs status');
    ctx.expectEq(notifsB.body.items.length >= 1, true, 'b has notif');
    const recvNotif = notifsB.body.items.find((n: any) => n.txn_id === txnId);
    ctx.expectEq(Boolean(recvNotif), true, 'recv notif found');
    ctx.expectEq(recvNotif.kind, 'TXN_RECEIVED', 'kind TXN_RECEIVED');
    ctx.expectEq(recvNotif.title, 'Money Received', 'title Money Received');
    ctx.expectEq(recvNotif.body.includes('Received ৳500.00'), true, 'body includes amount');
    ctx.expectEq(recvNotif.body.includes(a.user.name), true, 'body includes sender name');
  },
};

export const NOTIF_02: Scenario = {
  id: 'NOTIF-02',
  name: 'Money request paid generates REQUEST_PAID for requester',
  tags: ['notifications', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'NOTIF02');
    const req = await ctx.client.createRequest(a.access_token, b.user.phone, 30_000, 'for lunch');
    ctx.expectEq(req.status, 201, 'request created');
    const reqId = req.body.id;

    const su = await ctx.client.stepUp(b.access_token, 'PIN', b.pin);
    const paid = await ctx.client.payRequest(b.access_token, reqId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(paid.status, 200, 'request paid');

    const notifsA = await ctx.client.notifications(a.access_token);
    ctx.expectEq(notifsA.status, 200, 'a notifs');
    const paidNotif = notifsA.body.items.find((n: any) => n.kind === 'REQUEST_PAID');
    ctx.expectEq(Boolean(paidNotif), true, 'REQUEST_PAID notif found');
    ctx.expectEq(paidNotif.title, 'Request Paid', 'title Request Paid');
    ctx.expectEq(paidNotif.body.includes('paid your request for ৳300.00'), true, 'body has amount and text');
  },
};

export const NOTIF_03: Scenario = {
  id: 'NOTIF-03',
  name: 'Shared bill payment generates REQUEST_PAID for bill creator',
  tags: ['notifications', 'tier1'],
  async run(ctx) {
    const [a, b, c] = await ctx.freshUsers(3, 'NOTIF03');
    const bill = await ctx.client.createBill(a.access_token, 'Dinner', [
      { phone: b.user.phone, amount_paisa: 20_000 },
      { phone: c.user.phone, amount_paisa: 20_000 },
    ]);
    ctx.expectEq(bill.status, 201, 'bill created');
    const billId = bill.body.id;

    const su = await ctx.client.stepUp(b.access_token, 'PIN', b.pin);
    const payRes = await ctx.client.payBill(b.access_token, billId, ctx.uuid(), su.body.step_up_token);
    ctx.expectEq(payRes.status, 200, 'bill paid');

    const notifsA = await ctx.client.notifications(a.access_token);
    ctx.expectEq(notifsA.status, 200, 'a notifs');
    const paidNotif = notifsA.body.items.find((n: any) => n.kind === 'REQUEST_PAID');
    ctx.expectEq(Boolean(paidNotif), true, 'REQUEST_PAID bill notif found');
    ctx.expectEq(paidNotif.title, 'Bill Share Paid', 'title Bill Share Paid');
    ctx.expectEq(paidNotif.body.includes('paid their ৳200.00 share'), true, 'body has share text');
  },
};

export const NOTIF_04: Scenario = {
  id: 'NOTIF-04',
  name: 'Mark notification as read flips read_at and excludes from ?unread=true',
  tags: ['notifications', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'NOTIF04');
    await ctx.transfer(a, b, 10_000);

    const unreadBefore = await ctx.client.notifications(b.access_token, { unread: true });
    ctx.expectEq(unreadBefore.status, 200, 'unread before status');
    ctx.expectEq(unreadBefore.body.items.length >= 1, true, 'has unread notif');
    const notifId = unreadBefore.body.items[0].id;
    ctx.expectEq(unreadBefore.body.items[0].read_at, null, 'read_at is null');

    const markRes = await ctx.client.markNotificationRead(b.access_token, notifId);
    ctx.expectEq(markRes.status, 200, 'mark read status');
    ctx.expectEq(Boolean(markRes.body.read_at), true, 'read_at is now timestamp');

    const unreadAfter = await ctx.client.notifications(b.access_token, { unread: true });
    ctx.expectEq(unreadAfter.status, 200, 'unread after status');
    const stillUnread = unreadAfter.body.items.find((n: any) => n.id === notifId);
    ctx.expectEq(Boolean(stillUnread), false, 'marked notif excluded from unread');

    const allNotifs = await ctx.client.notifications(b.access_token);
    const readNotif = allNotifs.body.items.find((n: any) => n.id === notifId);
    ctx.expectEq(Boolean(readNotif), true, 'still in all notifs');
    ctx.expectEq(Boolean(readNotif.read_at), true, 'read_at populated');
  },
};

export const NOTIF_05: Scenario = {
  id: 'NOTIF-05',
  name: 'Reversal generates REVERSAL notification for both parties',
  tags: ['notifications', 'tier1'],
  async run(ctx) {
    const [a, b] = await ctx.freshUsers(2, 'NOTIF05');
    const txn = await ctx.transfer(a, b, 15_000);
    const txnId = txn.body.transaction.id;

    const su = await ctx.client.stepUp(a.access_token, 'PIN', a.pin);
    const rev = await ctx.client.reverse(a.access_token, txnId, ctx.uuid(), su.body.step_up_token);
    ctx.expect(rev.status === 200 || rev.status === 201, 'reversed status');

    const notifsA = await ctx.client.notifications(a.access_token);
    const revNotifA = notifsA.body.items.find((n: any) => n.kind === 'REVERSAL');
    ctx.expectEq(Boolean(revNotifA), true, 'a has REVERSAL notif');
    ctx.expectEq(revNotifA.title, 'Transaction Reversed', 'a title Transaction Reversed');

    const notifsB = await ctx.client.notifications(b.access_token);
    const revNotifB = notifsB.body.items.find((n: any) => n.kind === 'REVERSAL');
    ctx.expectEq(Boolean(revNotifB), true, 'b has REVERSAL notif');
    ctx.expectEq(revNotifB.title, 'Transaction Reversed', 'b title Transaction Reversed');
  },
};

export const notificationScenarios: Scenario[] = [NOTIF_01, NOTIF_02, NOTIF_03, NOTIF_04, NOTIF_05];
