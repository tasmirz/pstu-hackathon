import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AccountFrozen, DailyLimitExceeded, InsufficientFunds, newTxnRef } from '@pstu/shared';
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

    if (sender.status === 'FROZEN') throw new AccountFrozen();
    if (senderBalance < amountPaisa) throw new InsufficientFunds(senderBalance, amountPaisa);

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

    return response;
  }
}
