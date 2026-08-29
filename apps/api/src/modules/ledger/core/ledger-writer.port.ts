import { PoolClient } from 'pg';
import { EntryDto, TransactionDto, TxnKind, TxnState } from '@pstu/shared';

export interface MoveMoneyParams {
  senderId: number;
  receiverId: number;
  amountPaisa: number;
  kind: TxnKind;
  note?: string | null;
  parentTxnId?: number;
  reversesTxnId?: number;
  /** REVERSAL/HOLD_SETTLE/HOLD_CANCEL/REFUND don't count against the
   * sender's daily send cap — they're compensating entries, not new spend. */
  skipDailyLimitCheck?: boolean;
  senderAccountId?: number;
  receiverAccountId?: number;
  state?: TxnState;
  settleAfter?: Date | string | null;
  outboxTopic?: string;
}

export interface MoveMoneyResult {
  transaction: TransactionDto;
  balance_paisa: number;
  entries: EntryDto[];
}

/**
 * The one place double-entry money actually moves between two USER
 * accounts: lock order, frozen/insufficient-funds/daily-limit checks, the
 * transaction + entries + balance updates + outbox row, all in the caller's
 * existing DB transaction. TransferService, BillsService, RequestsService,
 * and ReversalService all call this instead of duplicating it — the "Repository/
 * Strategy" shape from PLAN.md §7.3, and the seam this module would export
 * as its port if split into its own service later.
 */
export interface LedgerWriterPort {
  moveMoney(client: PoolClient, params: MoveMoneyParams): Promise<MoveMoneyResult>;
}

export const LEDGER_WRITER_PORT = 'LEDGER_WRITER_PORT';
