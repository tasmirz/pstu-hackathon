import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { InvalidState, TxnNotFound } from '@pstu/shared';
import { LEDGER_WRITER_PORT, LedgerWriterPort, MoveMoneyResult } from './ledger-writer.port';

/**
 * Shared by the public `POST /transactions/:id/reverse` endpoint AND admin
 * dispute resolution (§4.3) — both are "create a compensating REVERSAL
 * transaction, CAS the original COMPLETED -> REVERSED, never edit history."
 * Caller owns the transaction, the idempotency claim, and any actor/step-up
 * checks specific to its own entry point.
 */
@Injectable()
export class ReversalCoreService {
  constructor(@Inject(LEDGER_WRITER_PORT) private readonly ledgerWriter: LedgerWriterPort) {}

  async applyReversal(client: PoolClient, originalTxnId: number): Promise<MoveMoneyResult> {
    const orig = await client.query(`SELECT * FROM ledger.transactions WHERE id = $1 FOR UPDATE`, [originalTxnId]);
    const txn = orig.rows[0];
    if (!txn) throw new TxnNotFound();
    if (txn.kind === 'REVERSAL') throw new InvalidState('A reversal cannot itself be reversed');

    // CAS FIRST, before any money moves — a concurrent duplicate reversal
    // loses right here with zero rows updated (SIMULATOR.md CON-05), and the
    // unique index on (reverses_txn_id) WHERE kind='REVERSAL' is the second,
    // DB-level backstop if two CASes somehow both raced past this point.
    const cas = await client.query(
      `UPDATE ledger.transactions SET state = 'REVERSED' WHERE id = $1 AND state = 'COMPLETED' RETURNING id`,
      [originalTxnId],
    );
    if (!cas.rowCount) {
      throw new InvalidState('This transaction has already been reversed, cancelled, or is not reversible');
    }

    // Mirrored entries: whoever received the original amount sends it back.
    // If they've already spent it, moveMoney throws InsufficientFunds here —
    // the whole transaction (including the CAS above) rolls back and the
    // original stays COMPLETED. We do not fabricate money to undo a transfer.
    return this.ledgerWriter.moveMoney(client, {
      senderId: txn.receiver_id,
      receiverId: txn.sender_id,
      amountPaisa: txn.amount,
      kind: 'REVERSAL',
      note: `Reversal of ${txn.ref}`,
      reversesTxnId: txn.id,
      skipDailyLimitCheck: true,
    });
  }
}
