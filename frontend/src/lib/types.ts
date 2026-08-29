export type UserStatus = 'ACTIVE' | 'FROZEN';
export type UserRole = 'USER' | 'ADMIN';

export interface User {
  id: number;
  phone: string;
  name: string;
  status: UserStatus;
  role?: UserRole;
  totp_enrolled?: boolean;
  created_at?: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  signup_bonus_paisa?: number;
  balance_paisa?: number;
}

export type TxnKind = 
  | 'SIGNUP_BONUS'
  | 'TRANSFER'
  | 'REQUEST_SETTLE'
  | 'BILL_SHARE_SETTLE'
  | 'SPLIT'
  | 'HOLD_SETTLE'
  | 'HOLD_CANCEL'
  | 'REVERSAL'
  | 'REFUND'
  | 'ESCROW_PLACE'
  | 'ESCROW_CLAIM'
  | 'ESCROW_REFUND';

export type TxnState = 
  | 'PENDING'
  | 'HELD'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REVERSED';

export interface Counterparty {
  id?: number;
  name: string;
  phone: string;
}

export interface LedgerEntry {
  account_id: number;
  account_type?: string;
  amount_paisa: number;
}

export interface Transaction {
  id: number;
  ref: string;
  kind: TxnKind;
  state: TxnState;
  direction?: 'sent' | 'received';
  amount_paisa: number;
  note?: string;
  counterparty?: Counterparty;
  reverses_txn_id?: number | null;
  parent_txn_id?: number | null;
  settle_after?: string | null;
  can_cancel_until?: string | null;
  created_at: string;
  entries?: LedgerEntry[];
  reversal?: {
    id: number;
    created_at: string;
  } | null;
  can_reverse?: boolean;
  disputed?: boolean;
}

export interface BalanceResponse {
  balance_paisa: number;
  held_paisa: number;
  available_paisa: number;
}

export interface LimitsResponse {
  daily_limit_paisa: number;
  spent_today_paisa: number;
  remaining_paisa: number;
  resets_at: string;
}

export type MoneyRequestState = 'PENDING' | 'PAID' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface MoneyRequest {
  id: number;
  from_user_id?: number;
  to_user_id?: number;
  state: MoneyRequestState;
  amount_paisa: number;
  note?: string;
  requester?: { id: number; name: string; phone: string };
  payer?: { id: number; name: string; phone: string };
  expires_at: string;
  created_at: string;
}

export type DisputeState = 'OPEN' | 'REVERSED' | 'REJECTED';

export interface Dispute {
  id: number;
  txn_id: number;
  state: DisputeState;
  reason: string;
  resolution?: string | null;
  raised_by?: {
    id: number;
    name: string;
    role: 'sender' | 'receiver';
  };
  transaction?: {
    id: number;
    ref: string;
    amount_paisa: number;
    state: TxnState;
    created_at: string;
  };
  counterparty?: {
    id: number;
    name: string;
  };
  reversible_now?: boolean;
  attempts?: number;
  last_attempt_error?: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: number | null;
}

export type BillState = 'OPEN' | 'SETTLED' | 'CANCELLED';
export type BillShareState = 'PENDING' | 'PAID' | 'CANCELLED';

export interface BillShare {
  id: number;
  payer: { id: number; name: string; phone: string };
  amount_paisa: number;
  state: BillShareState;
  settled_txn_id?: number | null;
}

export interface Bill {
  id: number;
  ref: string;
  title: string;
  total_amount_paisa: number;
  state: BillState;
  created_by: { id: number; name: string; phone?: string };
  shares: BillShare[];
  created_at: string;
}

export interface IntegrityCheckReport {
  conservation: {
    pass: boolean;
    total_paisa: number;
  };
  balance_drift: {
    pass: boolean;
    accounts_checked: number;
    drifted: Array<{ account_id: number; drift_paisa: number }>;
  };
  negative: {
    pass: boolean;
    accounts: Array<{ account_id: number; balance_paisa: number }>;
  };
  chain: {
    pass: boolean;
    verified_to_entry_id: number;
  };
  checked_at: string;
}

export interface SystemHealth {
  db: { ok: boolean; latency_ms: number };
  pgbouncer: { ok: boolean; cl_active: number; sv_active: number; pool_size: number };
  kafka: { ok: boolean; consumer_lag: number };
  redis: { ok: boolean; hit_rate: number; keys: number };
  outbox: { unprocessed: number; dead_letter: number; oldest_unprocessed_age_s: number | null };
}

export interface SystemMetrics {
  tps: number;
  p95_latency_ms: number;
  active_locks: number;
  connections: number;
}

export interface LoadTestResult {
  duration_ms: number;
  tps: number;
  p95_latency_ms: number;
  supply_before_paisa: number;
  supply_after_paisa: number;
  supply_unchanged: boolean;
  negative_balances: number;
  failed: number;
  deadlocks: number;
}

export interface NotificationItem {
  id: number;
  event_id: string;
  title: string;
  message: string;
  amount_paisa?: number;
  read: boolean;
  created_at: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, any>;
}
