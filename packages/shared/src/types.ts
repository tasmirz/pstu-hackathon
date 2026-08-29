/** Shapes shared across services — mirrors API.md. Wire format, not DB rows. */

export type AccountType = 'USER' | 'SYSTEM_MINT' | 'HOLD' | 'ESCROW';

export type TxnKind =
  | 'SIGNUP_BONUS'
  | 'TRANSFER'
  | 'REQUEST_SETTLE'
  | 'SPLIT'
  | 'HOLD_SETTLE'
  | 'HOLD_CANCEL'
  | 'REVERSAL'
  | 'REFUND'
  | 'ESCROW_PLACE'
  | 'ESCROW_CLAIM'
  | 'ESCROW_REFUND'
  | 'BILL_SHARE_SETTLE';

export type TxnState = 'PENDING' | 'HELD' | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'REVERSED';

export interface CounterpartyDto {
  id: number;
  name: string;
  phone: string;
}

export interface TransactionDto {
  id: number;
  ref: string;
  kind: TxnKind;
  state: TxnState;
  amount_paisa: number;
  note: string | null;
  counterparty?: CounterpartyDto;
  settle_after?: string | null;
  reverses_txn_id?: number | null;
  created_at: string;
}

export interface EntryDto {
  account_id: number;
  account_type?: AccountType;
  amount_paisa: number;
}

export interface TransferResponseDto {
  transaction: TransactionDto;
  balance_paisa: number;
  entries: EntryDto[];
  can_cancel_until?: string;
}

export interface UserDto {
  id: number;
  phone: string;
  name: string;
  status: 'ACTIVE' | 'FROZEN';
}
