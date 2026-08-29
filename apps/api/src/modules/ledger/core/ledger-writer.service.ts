import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AccountFrozen, DailyLimitExceeded, InsufficientFunds, newTxnRef, taka } from '@pstu/shared';
import { config } from '../../../config';
import { AccountsRepository } from './accounts.repository';
import { UsersRepository } from './users.repository';
import { LedgerWriterPort, MoveMoneyParams, MoveMoneyResult } from './ledger-writer.port';

@Injectable()
export class LedgerWriterService implements LedgerWriterPort {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly users: UsersRepository,
  ) {}

  async moveMoney(client: PoolClient, params: MoveMoneyParams): Promise<MoveMoneyResult> {
    const {
      senderId,
      receiverId,
      amountPaisa,
      kind,
      note,
      parentTxnId,
      reversesTxnId,
      skipDailyLimitCheck,
      senderAccountId: overrideSenderAccountId,
      receiverAccountId: overrideReceiverAccountId,
      state: overrideState,
      settleAfter,
      outboxTopic,
    } = params;

    const [sender, receiver] = await Promise.all([
      this.users.findById(senderId, client),
      this.users.findById(receiverId, client),
    ]);

    const senderAccountId =
      overrideSenderAccountId ?? (await this.accounts.getUserAccountId(client, senderId));
    const receiverAccountId =
      overrideReceiverAccountId ?? (await this.accounts.getUserAccountId(client, receiverId));

    // Lock both accounts in ASCENDING id order — the whole deadlock strategy
    // (PLAN.md §3.2). Two concurrent transfers touching the same pair of
    // accounts, in either direction, acquire locks in the same order.
    const ids = [senderAccountId, receiverAccountId].sort((a, b) => a - b);
    const locked = await client.query(
      `SELECT id, balance FROM ledger.accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
      [ids],
    );
    const balanceById = new Map<number, number>(locked.rows.map((r) => [r.id, r.balance]));
    const senderBalance = balanceById.get(senderAccountId)!;

    // Check for any open dispute holds on sender
    const disputeHoldRes = await client.query(
      `SELECT COALESCE(SUM(d.secured_amount), 0) AS dispute_holds
       FROM ledger.disputes d
       JOIN ledger.transactions t ON t.id = d.txn_id
       WHERE t.receiver_id = $1 AND d.state = 'OPEN'`,
      [senderId],
    );
    const disputeHolds = parseInt(disputeHoldRes.rows[0]?.dispute_holds ?? '0', 10);
    const availableBalance = Math.max(0, senderBalance - disputeHolds);

    if (sender.status === 'FROZEN') throw new AccountFrozen();
    if (availableBalance < amountPaisa && kind !== 'REVERSAL') {
      throw new InsufficientFunds(availableBalance, amountPaisa);
    }

    if (!skipDailyLimitCheck) {
      const spentToday = await this.accounts.spentToday(client, senderAccountId);
      const dailyLimit = await this.accounts.dailyLimit(client, senderId, config.dailyLimitDefaultPaisa);
      if (spentToday + amountPaisa > dailyLimit) {
        throw new DailyLimitExceeded({
          daily_limit_paisa: dailyLimit,
          spent_today_paisa: spentToday,
          amount_paisa: amountPaisa,
        });
      }
    }

    const ref = newTxnRef();
    const txnState = overrideState ?? 'COMPLETED';
    const txnRes = await client.query(
      `INSERT INTO ledger.transactions
         (ref, kind, state, sender_id, receiver_id, amount, note, parent_txn_id, reverses_txn_id, settle_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        ref,
        kind,
        txnState,
        senderId,
        receiverId,
        amountPaisa,
        note ?? null,
        parentTxnId ?? null,
        reversesTxnId ?? null,
        settleAfter ?? null,
      ],
    );
    const txn = txnRes.rows[0];

    await client.query(
      `INSERT INTO ledger.entries (txn_id, account_id, amount) VALUES ($1, $2, $3), ($1, $4, $5)`,
      [txn.id, senderAccountId, -amountPaisa, receiverAccountId, amountPaisa],
    );
    await client.query(`UPDATE ledger.accounts SET balance = balance - $1 WHERE id = $2`, [
      amountPaisa,
      senderAccountId,
    ]);
    await client.query(`UPDATE ledger.accounts SET balance = balance + $1 WHERE id = $2`, [
      amountPaisa,
      receiverAccountId,
    ]);

    const newBalance = await this.accounts.getBalance(client, senderAccountId);

    const response: MoveMoneyResult = {
      transaction: {
        id: txn.id,
        ref: txn.ref,
        kind: txn.kind,
        state: txn.state,
        amount_paisa: txn.amount,
        note: txn.note,
        counterparty: { id: receiver.id, name: receiver.name, phone: receiver.phone },
        settle_after: txn.settle_after,
        reverses_txn_id: txn.reverses_txn_id,
        created_at: txn.created_at,
      },
      balance_paisa: newBalance,
      entries: [
        { account_id: senderAccountId, amount_paisa: -amountPaisa },
        { account_id: receiverAccountId, amount_paisa: amountPaisa },
      ],
    };

    // Outbox, in the SAME commit — what makes the event durable even if the
    // process dies right after (PLAN.md §1.1 Decision 3).
    const topic = outboxTopic ?? 'txn.completed';
    await client.query(`INSERT INTO ledger.outbox (topic, payload) VALUES ($1, $2)`, [
      topic,
      JSON.stringify({ ...response, sender_id: senderId }),
    ]);

    // Direct notifications in the SAME transaction (Round 6)
    if (kind === 'TRANSFER') {
      await client.query(
        `INSERT INTO notify.notifications (user_id, kind, title, body, txn_id)
         VALUES ($1, 'TXN_SENT', 'Money Sent', $2, $3),
                ($4, 'TXN_RECEIVED', 'Money Received', $5, $3)`,
        [
          senderId,
          `Sent ${taka(amountPaisa)} to ${receiver.name}`,
          txn.id,
          receiverId,
          `Received ${taka(amountPaisa)} from ${sender.name}`,
        ],
      );
    } else if (kind === 'HOLD_SETTLE') {
      await client.query(
        `INSERT INTO notify.notifications (user_id, kind, title, body, txn_id)
         VALUES ($1, 'TXN_RECEIVED', 'Money Received', $2, $3)`,
        [
          receiverId,
          `Received ${taka(amountPaisa)} from ${sender.name}`,
          txn.id,
        ],
      );
    } else if (kind === 'REQUEST_SETTLE') {
      // sender is payer, receiver is requester
      await client.query(
        `INSERT INTO notify.notifications (user_id, kind, title, body, txn_id)
         VALUES ($1, 'REQUEST_PAID', 'Request Paid', $2, $3)`,
        [
          receiverId,
          `${sender.name} paid your request for ${taka(amountPaisa)}`,
          txn.id,
        ],
      );
    } else if (kind === 'BILL_SHARE_SETTLE') {
      // sender is payer, receiver is bill creator
      const desc = note
        ? `${sender.name} paid their ${taka(amountPaisa)} share: ${note}`
        : `${sender.name} paid their ${taka(amountPaisa)} share of bill`;
      await client.query(
        `INSERT INTO notify.notifications (user_id, kind, title, body, txn_id)
         VALUES ($1, 'REQUEST_PAID', 'Bill Share Paid', $2, $3)`,
        [
          receiverId,
          desc,
          txn.id,
        ],
      );
    } else if (kind === 'REVERSAL') {
      const desc = note ? `Reversed: ${note}` : `Transaction reversed for ${taka(amountPaisa)}`;
      await client.query(
        `INSERT INTO notify.notifications (user_id, kind, title, body, txn_id)
         VALUES ($1, 'REVERSAL', 'Transaction Reversed', $2, $3),
                ($4, 'REVERSAL', 'Transaction Reversed', $2, $3)`,
        [
          senderId,
          desc,
          txn.id,
          receiverId,
        ],
      );
    }

    return response;
  }
}
