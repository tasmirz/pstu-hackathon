import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  BillNotFound,
  BillShareNotFound,
  canonical,
  InvalidState,
  newTxnRef,
  NotAParty,
  SelfTransfer,
  sha256,
  ValidationError,
  withTransaction,
} from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../../../common/idempotency.util';
import { requireStepUp } from '../../../common/step-up.util';
import { config } from '../../../config';
import { UsersRepository } from '../core/users.repository';
import { LEDGER_WRITER_PORT, LedgerWriterPort } from '../core/ledger-writer.port';

export interface PayBillShareParams {
  payerId: number;
  billId: number;
  amountPaisa?: number;
  idemKey: string;
  stepUpToken?: string;
}

export interface ShareInput {
  phone: string;
  amount_paisa?: number;
}

export interface CreateBillParams {
  creatorId: number;
  title: string;
  splitMode?: 'CUSTOM' | 'EQUAL';
  totalAmountPaisa?: number;
  shares: ShareInput[];
}

@Injectable()
export class BillsService {
  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    @Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort,
    private readonly users: UsersRepository,
  ) {}

  async create(
    paramsOrCreatorId: CreateBillParams | number,
    titleArg?: string,
    sharesArg?: ShareInput[],
    splitModeArg?: 'CUSTOM' | 'EQUAL',
    totalAmountPaisaArg?: number,
  ) {
    let creatorId: number;
    let title: string;
    let splitMode: 'CUSTOM' | 'EQUAL' = 'CUSTOM';
    let declaredTotal: number | undefined;
    let shares: ShareInput[];

    if (typeof paramsOrCreatorId === 'number') {
      creatorId = paramsOrCreatorId;
      title = titleArg || '';
      shares = sharesArg || [];
      splitMode = splitModeArg || 'CUSTOM';
      declaredTotal = totalAmountPaisaArg;
    } else {
      creatorId = paramsOrCreatorId.creatorId;
      title = paramsOrCreatorId.title;
      shares = paramsOrCreatorId.shares;
      splitMode = paramsOrCreatorId.splitMode || 'CUSTOM';
      declaredTotal = paramsOrCreatorId.totalAmountPaisa;
    }

    if (!shares || shares.length < 2) {
      throw new ValidationError('A shared bill must have at least 2 shares');
    }

    const phones = shares.map((s) => s.phone);
    if (new Set(phones).size !== phones.length) {
      throw new ValidationError('Duplicate phone numbers in bill shares');
    }

    let calculatedTotal = declaredTotal;
    let sharesWithAmounts: Array<{ phone: string; amount_paisa: number }> = [];

    if (splitMode === 'EQUAL') {
      if (!calculatedTotal && shares.every((s) => s.amount_paisa && s.amount_paisa > 0)) {
        calculatedTotal = shares.reduce((acc, s) => acc + (s.amount_paisa || 0), 0);
      }
      if (!calculatedTotal || calculatedTotal <= 0) {
        throw new ValidationError('total_amount_paisa is required for EQUAL split mode');
      }

      const count = shares.length;
      const base = Math.floor(calculatedTotal / count);
      const remainder = calculatedTotal % count;

      sharesWithAmounts = shares.map((s, idx) => ({
        phone: s.phone,
        amount_paisa: base + (idx < remainder ? 1 : 0),
      }));
    } else {
      // CUSTOM split mode
      for (const share of shares) {
        if (!share.amount_paisa || share.amount_paisa <= 0) {
          throw new ValidationError('Every share in CUSTOM mode must have a positive amount');
        }
      }
      const sum = shares.reduce((acc, s) => acc + (s.amount_paisa || 0), 0);
      if (declaredTotal !== undefined && declaredTotal !== sum) {
        throw new ValidationError('Declared total_amount_paisa does not match the sum of custom shares');
      }
      calculatedTotal = sum;
      sharesWithAmounts = shares.map((s) => ({
        phone: s.phone,
        amount_paisa: s.amount_paisa!,
      }));
    }

    const resolvedPayers = await Promise.all(
      sharesWithAmounts.map(async (s) => {
        const user = await this.users.findByPhone(s.phone);
        if (user.id === creatorId) {
          throw new SelfTransfer();
        }
        return {
          user,
          amount_paisa: s.amount_paisa,
        };
      }),
    );

    return withTransaction(this.pool, async (t) => {
      const ref = 'BILL_' + newTxnRef().slice(4);
      const billRes = await t.query(
        `INSERT INTO ledger.bills (ref, created_by, title, total_amount, split_mode, state)
         VALUES ($1, $2, $3, $4, $5, 'OPEN')
         RETURNING id, ref, created_by, title, total_amount, split_mode, state, created_at`,
        [ref, creatorId, title, calculatedTotal, splitMode],
      );
      const bill = billRes.rows[0];

      const insertedShares: Array<{
        id: number;
        payer: { id: number; name: string; phone: string };
        amount_paisa: number;
        paid_amount_paisa: number;
        state: string;
      }> = [];
      for (const item of resolvedPayers) {
        const shareRes = await t.query(
          `INSERT INTO ledger.bill_shares (bill_id, payer_id, amount, paid_amount, state)
           VALUES ($1, $2, $3, 0, 'PENDING')
           RETURNING id, bill_id, payer_id, amount, paid_amount, state, created_at`,
          [bill.id, item.user.id, item.amount_paisa],
        );
        const s = shareRes.rows[0];
        insertedShares.push({
          id: s.id,
          payer: {
            id: item.user.id,
            name: item.user.name,
            phone: item.user.phone,
          },
          amount_paisa: s.amount,
          paid_amount_paisa: s.paid_amount,
          state: s.state,
        });
      }

      return {
        id: bill.id,
        ref: bill.ref,
        title: bill.title,
        split_mode: bill.split_mode,
        total_amount_paisa: bill.total_amount,
        state: bill.state,
        shares: insertedShares,
        created_at: bill.created_at,
      };
    });
  }

  async pay(params: PayBillShareParams) {
    const { payerId, billId, amountPaisa, idemKey, stepUpToken } = params;

    const reqHash = sha256(canonical({ payerId, billId, amountPaisa: amountPaisa ?? null }));

    return withTransaction(this.pool, async (t) => {
      const claim = await claimIdempotencyKey(t, payerId, idemKey, reqHash);
      if (!claim.isNew) return claim.response;

      // Lock parent bill first (BS-05 consistent lock ordering)
      const billRes = await t.query(`SELECT * FROM ledger.bills WHERE id = $1 FOR UPDATE`, [billId]);
      const bill = billRes.rows[0];
      if (!bill) {
        throw new BillNotFound();
      }
      if (bill.state === 'CANCELLED') {
        throw new InvalidState('This bill has been cancelled');
      }
      if (bill.state !== 'OPEN') {
        throw new InvalidState('This bill is not open');
      }

      // Lock payer's share
      const shareRes = await t.query(
        `SELECT * FROM ledger.bill_shares WHERE bill_id = $1 AND payer_id = $2 FOR UPDATE`,
        [billId, payerId],
      );
      const share = shareRes.rows[0];
      if (!share) {
        throw new BillShareNotFound();
      }
      if (share.state === 'PAID' || share.state === 'CANCELLED') {
        throw new InvalidState('Your bill share is already paid or cancelled');
      }

      const currentPaid = share.paid_amount ?? 0;
      const remainingUnpaid = share.amount - currentPaid;
      if (remainingUnpaid <= 0) {
        throw new InvalidState('Your bill share is already fully paid');
      }

      let paymentAmount: number;
      if (amountPaisa !== undefined && amountPaisa !== null) {
        if (amountPaisa <= 0 || amountPaisa > remainingUnpaid) {
          throw new ValidationError(
            `Payment amount (${amountPaisa}) must be positive and cannot exceed remaining unpaid balance (${remainingUnpaid})`,
          );
        }
        paymentAmount = amountPaisa;
      } else {
        paymentAmount = remainingUnpaid;
      }

      // Step-up authentication against bill creator
      const priorTxn = await t.query(
        `SELECT 1 FROM ledger.transactions
         WHERE sender_id = $1 AND receiver_id = $2 AND state = 'COMPLETED' LIMIT 1`,
        [payerId, bill.created_by],
      );
      if (priorTxn.rowCount === 0) {
        requireStepUp({ userId: payerId, token: stepUpToken, reason: 'FIRST_TIME_RECIPIENT', always: true });
      }
      requireStepUp({ userId: payerId, token: stepUpToken, reason: 'AMOUNT_THRESHOLD', amountPaisa: paymentAmount });

      // Recipient (bill creator) reputation check
      const repRes = await t.query(
        `SELECT reputation_score FROM ledger.v_user_reputation WHERE user_id = $1`,
        [bill.created_by],
      );
      const creatorScore = repRes.rows[0]?.reputation_score ?? 50;
      if (creatorScore < config.reputationStepUpThreshold) {
        requireStepUp({ userId: payerId, token: stepUpToken, reason: 'LOW_REPUTATION_RECIPIENT', always: true });
      }

      const moveResult = await this.ledgerWriter.moveMoney(t, {
        senderId: payerId,
        receiverId: bill.created_by,
        amountPaisa: paymentAmount,
        kind: 'BILL_SHARE_SETTLE',
        note: bill.title,
      });

      const newPaid = currentPaid + paymentAmount;
      const newShareState = newPaid === share.amount ? 'PAID' : 'PARTIALLY_PAID';

      const shareUpdate = await t.query(
        `UPDATE ledger.bill_shares
         SET paid_amount = $1, state = $2, settled_txn_id = $3,
             paid_at = CASE WHEN $2 = 'PAID' THEN now() ELSE paid_at END
         WHERE id = $4
         RETURNING *`,
        [newPaid, newShareState, moveResult.transaction.id, share.id],
      );
      if (!shareUpdate.rowCount) {
        throw new InvalidState('Failed to update bill share state');
      }

      // Record in bill_payments append-only table
      await t.query(
        `INSERT INTO ledger.bill_payments (bill_id, share_id, payer_id, amount, txn_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [billId, share.id, payerId, paymentAmount, moveResult.transaction.id],
      );

      // Check if all shares are fully settled
      const remainingRes = await t.query(
        `SELECT count(*) AS remaining_count FROM ledger.bill_shares WHERE bill_id = $1 AND state != 'PAID'`,
        [billId],
      );
      let billState = bill.state;
      if (parseInt(remainingRes.rows[0].remaining_count, 10) === 0) {
        const billUpdate = await t.query(
          `UPDATE ledger.bills SET state = 'SETTLED' WHERE id = $1 AND state = 'OPEN' RETURNING state`,
          [billId],
        );
        if (billUpdate.rowCount) {
          billState = 'SETTLED';
        }
      }

      const response = {
        transaction: moveResult.transaction,
        balance_paisa: moveResult.balance_paisa,
        bill: {
          id: bill.id,
          state: billState,
        },
        share: {
          id: share.id,
          amount_paisa: share.amount,
          paid_amount_paisa: newPaid,
          remaining_paisa: share.amount - newPaid,
          state: newShareState,
        },
      };

      await storeIdempotencyResponse(t, payerId, idemKey, response);
      return response;
    });
  }

  async listMine(
    userId: number,
    role: 'created' | 'owed' = 'created',
    state?: string,
    cursor?: number,
    limit = 20,
  ) {
    const limitPlusOne = limit + 1;

    if (role === 'created') {
      const { rows } = await this.pool.query(
        `SELECT b.*, u.name AS creator_name
         FROM ledger.bills b
         JOIN auth.users_public u ON u.id = b.created_by
         WHERE b.created_by = $1
           AND ($2::text IS NULL OR b.state = $2::text)
           AND ($3::bigint IS NULL OR b.id < $3::bigint)
         ORDER BY b.id DESC
         LIMIT $4`,
        [userId, state ?? null, cursor ?? null, limitPlusOne],
      );

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const billIds = pageRows.map((r) => r.id);

      const sharesRes = billIds.length > 0
        ? await this.pool.query(
            `SELECT bs.id, bs.bill_id, bs.amount, bs.paid_amount, bs.state, bs.settled_txn_id,
                    u.id AS payer_id, u.name AS payer_name, u.phone AS payer_phone
             FROM ledger.bill_shares bs
             JOIN auth.users_public u ON u.id = bs.payer_id
             WHERE bs.bill_id = ANY($1::bigint[])
             ORDER BY bs.id ASC`,
            [billIds],
          )
        : { rows: [] };

      const sharesByBillId = new Map<number, any[]>();
      for (const s of sharesRes.rows) {
        if (!sharesByBillId.has(s.bill_id)) sharesByBillId.set(s.bill_id, []);
        sharesByBillId.get(s.bill_id)!.push({
          id: s.id,
          payer: { id: s.payer_id, name: s.payer_name, phone: s.payer_phone },
          amount_paisa: s.amount,
          paid_amount_paisa: s.paid_amount,
          remaining_paisa: s.amount - s.paid_amount,
          state: s.state,
          settled_txn_id: s.settled_txn_id,
        });
      }

      return {
        items: pageRows.map((r) => ({
          id: r.id,
          ref: r.ref,
          title: r.title,
          split_mode: r.split_mode,
          total_amount_paisa: r.total_amount,
          state: r.state,
          created_by: { id: r.created_by, name: r.creator_name },
          shares: sharesByBillId.get(r.id) || [],
          created_at: r.created_at,
        })),
        next_cursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        has_more: hasMore,
      };
    } else {
      const { rows } = await this.pool.query(
        `SELECT b.*, u.name AS creator_name,
                bs.id AS my_share_id, bs.amount AS my_share_amount, bs.paid_amount AS my_share_paid_amount,
                bs.state AS my_share_state, bs.settled_txn_id AS my_settled_txn_id
         FROM ledger.bills b
         JOIN ledger.bill_shares bs ON bs.bill_id = b.id
         JOIN auth.users_public u ON u.id = b.created_by
         WHERE bs.payer_id = $1
           AND ($2::text IS NULL OR b.state = $2::text)
           AND ($3::bigint IS NULL OR b.id < $3::bigint)
         ORDER BY b.id DESC
         LIMIT $4`,
        [userId, state ?? null, cursor ?? null, limitPlusOne],
      );

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const billIds = pageRows.map((r) => r.id);

      const sharesRes = billIds.length > 0
        ? await this.pool.query(
            `SELECT bs.id, bs.bill_id, bs.amount, bs.paid_amount, bs.state, bs.settled_txn_id,
                    u.id AS payer_id, u.name AS payer_name, u.phone AS payer_phone
             FROM ledger.bill_shares bs
             JOIN auth.users_public u ON u.id = bs.payer_id
             WHERE bs.bill_id = ANY($1::bigint[])
             ORDER BY bs.id ASC`,
            [billIds],
          )
        : { rows: [] };

      const sharesByBillId = new Map<number, any[]>();
      for (const s of sharesRes.rows) {
        if (!sharesByBillId.has(s.bill_id)) sharesByBillId.set(s.bill_id, []);
        sharesByBillId.get(s.bill_id)!.push({
          id: s.id,
          payer: { id: s.payer_id, name: s.payer_name, phone: s.payer_phone },
          amount_paisa: s.amount,
          paid_amount_paisa: s.paid_amount,
          remaining_paisa: s.amount - s.paid_amount,
          state: s.state,
          settled_txn_id: s.settled_txn_id,
        });
      }

      return {
        items: pageRows.map((r) => ({
          id: r.id,
          ref: r.ref,
          title: r.title,
          split_mode: r.split_mode,
          total_amount_paisa: r.total_amount,
          state: r.state,
          created_by: { id: r.created_by, name: r.creator_name },
          my_share: {
            id: r.my_share_id,
            amount_paisa: r.my_share_amount,
            paid_amount_paisa: r.my_share_paid_amount,
            remaining_paisa: r.my_share_amount - r.my_share_paid_amount,
            state: r.my_share_state,
            settled_txn_id: r.my_settled_txn_id,
          },
          shares: sharesByBillId.get(r.id) || [],
          created_at: r.created_at,
        })),
        next_cursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        has_more: hasMore,
      };
    }
  }

  async getById(billId: number) {
    const billRes = await this.pool.query(
      `SELECT b.*, u.name AS creator_name
       FROM ledger.bills b
       JOIN auth.users_public u ON u.id = b.created_by
       WHERE b.id = $1`,
      [billId],
    );
    const bill = billRes.rows[0];
    if (!bill) throw new BillNotFound();

    const sharesRes = await this.pool.query(
      `SELECT bs.id, bs.amount, bs.paid_amount, bs.state, bs.settled_txn_id, bs.created_at,
              u.id AS payer_id, u.name AS payer_name, u.phone AS payer_phone
       FROM ledger.bill_shares bs
       JOIN auth.users_public u ON u.id = bs.payer_id
       WHERE bs.bill_id = $1
       ORDER BY bs.id ASC`,
      [billId],
    );

    return {
      id: bill.id,
      ref: bill.ref,
      title: bill.title,
      split_mode: bill.split_mode,
      total_amount_paisa: bill.total_amount,
      state: bill.state,
      created_by: {
        id: bill.created_by,
        name: bill.creator_name,
      },
      shares: sharesRes.rows.map((s) => ({
        id: s.id,
        payer: {
          id: s.payer_id,
          name: s.payer_name,
          phone: s.payer_phone,
        },
        amount_paisa: s.amount,
        paid_amount_paisa: s.paid_amount,
        remaining_paisa: s.amount - s.paid_amount,
        state: s.state,
        settled_txn_id: s.settled_txn_id,
      })),
      created_at: bill.created_at,
    };
  }

  async cancel(creatorId: number, billId: number) {
    return withTransaction(this.pool, async (t) => {
      const billRes = await t.query(`SELECT * FROM ledger.bills WHERE id = $1 FOR UPDATE`, [billId]);
      const bill = billRes.rows[0];
      if (!bill) throw new BillNotFound();

      if (bill.created_by !== creatorId) {
        throw new NotAParty();
      }

      if (bill.state !== 'OPEN') {
        throw new InvalidState('Only OPEN bills can be cancelled');
      }

      const paidShareCheck = await t.query(
        `SELECT 1 FROM ledger.bill_shares
         WHERE bill_id = $1 AND (state IN ('PAID', 'PARTIALLY_PAID') OR paid_amount > 0)
         LIMIT 1`,
        [billId],
      );
      if ((paidShareCheck.rowCount ?? 0) > 0) {
        throw new InvalidState('Cannot cancel a bill where shares have already been paid');
      }

      // Cancel only pending shares
      await t.query(`UPDATE ledger.bill_shares SET state = 'CANCELLED' WHERE bill_id = $1 AND state = 'PENDING'`, [
        billId,
      ]);

      const billUpdate = await t.query(
        `UPDATE ledger.bills SET state = 'CANCELLED' WHERE id = $1 AND state = 'OPEN' RETURNING id, state`,
        [billId],
      );
      if (!billUpdate.rowCount) {
        throw new InvalidState('Bill is not in OPEN state');
      }

      return {
        id: bill.id,
        state: 'CANCELLED',
        bill: {
          id: bill.id,
          state: 'CANCELLED',
        },
      };
    });
  }
}
