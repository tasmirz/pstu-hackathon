import {
  User,
  Transaction,
  BalanceResponse,
  LimitsResponse,
  MoneyRequest,
  Dispute,
  IntegrityCheckReport,
  SystemHealth,
  SystemMetrics,
  LoadTestResult,
  NotificationItem,
} from './types';

interface StoredLedgerEntry {
  id: number;
  txn_id: number;
  account_id: number;
  user_id: number | null;
  amount_paisa: number;
  created_at: string;
}

interface StoredAccount {
  id: number;
  user_id: number | null;
  type: 'USER' | 'SYSTEM_MINT' | 'HOLD' | 'ESCROW';
  balance: number;
}

interface StoredState {
  users: Array<User & { pin: string }>;
  accounts: StoredAccount[];
  transactions: Transaction[];
  entries: StoredLedgerEntry[];
  moneyRequests: MoneyRequest[];
  disputes: Dispute[];
  notifications: NotificationItem[];
  idCounter: number;
}

const STORAGE_KEY = 'kinetic_ledger_mock_state_v1';

function getInitialState(): StoredState {
  const users: Array<User & { pin: string }> = [
    {
      id: 42,
      phone: '+8801712345678',
      name: 'Rahim Ahmed',
      status: 'ACTIVE',
      role: 'USER',
      pin: '1234',
      totp_enrolled: true,
      created_at: '2026-08-29T09:00:00Z',
    },
    {
      id: 43,
      phone: '+8801798765432',
      name: 'Karim Uddin',
      status: 'ACTIVE',
      role: 'USER',
      pin: '1234',
      totp_enrolled: false,
      created_at: '2026-08-29T09:05:00Z',
    },
    {
      id: 44,
      phone: '+8801733445566',
      name: 'Alam Hossain',
      status: 'ACTIVE',
      role: 'USER',
      pin: '1234',
      totp_enrolled: false,
      created_at: '2026-08-29T09:10:00Z',
    },
    {
      id: 45,
      phone: '+8801755667788',
      name: 'Nadia Sultana',
      status: 'ACTIVE',
      role: 'USER',
      pin: '1234',
      totp_enrolled: false,
      created_at: '2026-08-29T09:15:00Z',
    },
    {
      id: 1,
      phone: '+8801700000000',
      name: 'System Admin',
      status: 'ACTIVE',
      role: 'ADMIN',
      pin: '9999',
      totp_enrolled: true,
      created_at: '2026-08-29T08:00:00Z',
    },
  ];

  // Accounts: SYSTEM_MINT is account #1.
  // Each user has a USER account (#80 + user_id) and a HOLD account (#180 + user_id).
  const accounts: StoredAccount[] = [
    { id: 1, user_id: null, type: 'SYSTEM_MINT', balance: -23450000 },
    { id: 84, user_id: 42, type: 'USER', balance: 9750000 },
    { id: 184, user_id: 42, type: 'HOLD', balance: 1000000 },
    { id: 86, user_id: 43, type: 'USER', balance: 4500000 },
    { id: 186, user_id: 43, type: 'HOLD', balance: 0 },
    { id: 88, user_id: 44, type: 'USER', balance: 1200000 },
    { id: 188, user_id: 44, type: 'HOLD', balance: 0 },
    { id: 90, user_id: 45, type: 'USER', balance: 8000000 },
    { id: 190, user_id: 45, type: 'HOLD', balance: 0 },
    { id: 92, user_id: 1, type: 'USER', balance: 0 },
    { id: 192, user_id: 1, type: 'HOLD', balance: 0 },
  ];

  const transactions: Transaction[] = [
    {
      id: 1043,
      ref: 'TXN_01J8XKQ4AB12345',
      kind: 'TRANSFER',
      state: 'COMPLETED',
      amount_paisa: 250000,
      note: 'lunch',
      counterparty: { id: 43, name: 'Karim Uddin', phone: '+8801798765432' },
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      can_reverse: true,
      entries: [
        { account_id: 84, account_type: 'USER', amount_paisa: -250000 },
        { account_id: 86, account_type: 'USER', amount_paisa: 250000 },
      ],
    },
    {
      id: 1042,
      ref: 'TXN_01J8XK39ZZ99887',
      kind: 'REQUEST_SETTLE',
      state: 'COMPLETED',
      amount_paisa: 120000,
      note: 'dinner split',
      counterparty: { id: 44, name: 'Alam Hossain', phone: '+8801733445566' },
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      can_reverse: false,
      entries: [
        { account_id: 88, account_type: 'USER', amount_paisa: -120000 },
        { account_id: 84, account_type: 'USER', amount_paisa: 120000 },
      ],
    },
    {
      id: 1041,
      ref: 'TXN_01J8XJ11AA55443',
      kind: 'REVERSAL',
      state: 'COMPLETED',
      amount_paisa: 50000,
      note: 'Reversed: Sent ৳500 to wrong number',
      reverses_txn_id: 1039,
      counterparty: { id: 43, name: 'Karim Uddin', phone: '+8801798765432' },
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      can_reverse: false,
      entries: [
        { account_id: 86, account_type: 'USER', amount_paisa: -50000 },
        { account_id: 84, account_type: 'USER', amount_paisa: 50000 },
      ],
    },
    {
      id: 1040,
      ref: 'TXN_01J8XH99BB33221',
      kind: 'TRANSFER',
      state: 'HELD',
      amount_paisa: 1000000,
      note: 'equipment purchase',
      settle_after: new Date(Date.now() + 47 * 1000).toISOString(),
      can_cancel_until: new Date(Date.now() + 47 * 1000).toISOString(),
      counterparty: { id: 43, name: 'Karim Uddin', phone: '+8801798765432' },
      created_at: new Date(Date.now() - 13 * 1000).toISOString(),
      can_reverse: false,
      entries: [
        { account_id: 84, account_type: 'USER', amount_paisa: -1000000 },
        { account_id: 184, account_type: 'HOLD', amount_paisa: 1000000 },
      ],
    },
  ];

  const entries: StoredLedgerEntry[] = [
    { id: 1, txn_id: 1043, account_id: 84, user_id: 42, amount_paisa: -250000, created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
    { id: 2, txn_id: 1043, account_id: 86, user_id: 43, amount_paisa: 250000, created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
    { id: 3, txn_id: 1042, account_id: 88, user_id: 44, amount_paisa: -120000, created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    { id: 4, txn_id: 1042, account_id: 84, user_id: 42, amount_paisa: 120000, created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    { id: 5, txn_id: 1041, account_id: 86, user_id: 43, amount_paisa: -50000, created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
    { id: 6, txn_id: 1041, account_id: 84, user_id: 42, amount_paisa: 50000, created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
    { id: 7, txn_id: 1040, account_id: 84, user_id: 42, amount_paisa: -1000000, created_at: new Date(Date.now() - 13 * 1000).toISOString() },
    { id: 8, txn_id: 1040, account_id: 184, user_id: 42, amount_paisa: 1000000, created_at: new Date(Date.now() - 13 * 1000).toISOString() },
  ];

  const moneyRequests: MoneyRequest[] = [
    {
      id: 77,
      from_user_id: 44, // Alam
      to_user_id: 42,   // Rahim
      state: 'PENDING',
      amount_paisa: 120000,
      note: 'for the ticket',
      requester: { id: 44, name: 'Alam Hossain', phone: '+8801733445566' },
      payer: { id: 42, name: 'Rahim Ahmed', phone: '+8801712345678' },
      expires_at: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 78,
      from_user_id: 42, // Rahim
      to_user_id: 45,   // Nadia
      state: 'PENDING',
      amount_paisa: 350000,
      note: 'project contribution',
      requester: { id: 42, name: 'Rahim Ahmed', phone: '+8801712345678' },
      payer: { id: 45, name: 'Nadia Sultana', phone: '+8801755667788' },
      expires_at: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 76,
      from_user_id: 43,
      to_user_id: 42,
      state: 'EXPIRED',
      amount_paisa: 50000,
      note: 'coffee meetup',
      requester: { id: 43, name: 'Karim Uddin', phone: '+8801798765432' },
      payer: { id: 42, name: 'Rahim Ahmed', phone: '+8801712345678' },
      expires_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 29 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const disputes: Dispute[] = [
    {
      id: 12,
      txn_id: 1043,
      state: 'OPEN',
      reason: 'Sent to the wrong number',
      raised_by: { id: 42, name: 'Rahim Ahmed', role: 'sender' },
      transaction: {
        id: 1043,
        ref: 'TXN_01J8XKQ4AB12345',
        amount_paisa: 250000,
        state: 'COMPLETED',
        created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      },
      counterparty: { id: 43, name: 'Karim Uddin' },
      reversible_now: true,
      attempts: 0,
      last_attempt_error: null,
      created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    },
    {
      id: 14,
      txn_id: 1042,
      state: 'OPEN',
      reason: 'Paid twice for the same order',
      raised_by: { id: 45, name: 'Nadia Sultana', role: 'receiver' },
      transaction: {
        id: 1042,
        ref: 'TXN_01J8XK39ZZ99887',
        amount_paisa: 80000,
        state: 'COMPLETED',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      counterparty: { id: 44, name: 'Alam Hossain' },
      reversible_now: false,
      attempts: 1,
      last_attempt_error: 'INSUFFICIENT_FUNDS: Receiver balance is ৳400.00',
      created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    },
  ];

  const notifications: NotificationItem[] = [
    {
      id: 1,
      event_id: 'evt_1043',
      title: 'Transfer Sent',
      message: 'You sent ৳2,500.00 to Karim Uddin',
      amount_paisa: 250000,
      read: false,
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    },
    {
      id: 2,
      event_id: 'evt_req77',
      title: 'Money Request Received',
      message: 'Alam Hossain requested ৳1,200.00 for the ticket',
      amount_paisa: 120000,
      read: false,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return {
    users,
    accounts,
    transactions,
    entries,
    moneyRequests,
    disputes,
    notifications,
    idCounter: 2000,
  };
}

class MockEngine {
  private state: StoredState;
  private listeners: Set<(event: string, data: any) => void> = new Set();

  constructor() {
    this.state = this.loadState();
    this.startSweeper();
  }

  private loadState(): StoredState {
    if (typeof window === 'undefined') {
      return getInitialState();
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    const init = getInitialState();
    this.saveState(init);
    return init;
  }

  private saveState(state: StoredState = this.state) {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }

  public resetState() {
    this.state = getInitialState();
    this.saveState();
    this.emit('state.reset', {});
  }

  public subscribe(cb: (event: string, data: any) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(event: string, data: any) {
    this.listeners.forEach((cb) => cb(event, data));
  }

  private startSweeper() {
    if (typeof window === 'undefined') return;
    setInterval(() => {
      const now = new Date().getTime();
      let changed = false;

      this.state.transactions.forEach((txn) => {
        if (txn.state === 'HELD' && txn.settle_after) {
          const settleTime = new Date(txn.settle_after).getTime();
          if (now >= settleTime) {
            // Settle hold: move from HOLD account to Receiver USER account
            txn.state = 'COMPLETED';
            txn.can_cancel_until = null;
            txn.can_reverse = true;

            // Update ledger legs
            const senderUser = this.state.users.find((u) => u.name === 'Rahim Ahmed') || this.state.users[0];
            const receiver = this.state.users.find((u) => u.phone === txn.counterparty?.phone);

            if (receiver) {
              const senderHoldAcc = this.state.accounts.find((a) => a.user_id === senderUser.id && a.type === 'HOLD');
              const receiverUserAcc = this.state.accounts.find((a) => a.user_id === receiver.id && a.type === 'USER');

              if (senderHoldAcc && receiverUserAcc) {
                senderHoldAcc.balance -= txn.amount_paisa;
                receiverUserAcc.balance += txn.amount_paisa;
              }
            }

            changed = true;
            this.emit('txn.completed', { txn, message: `Transfer to ${txn.counterparty?.name} completed!` });
          }
        }
      });

      if (changed) {
        this.saveState();
      }
    }, 1000);
  }

  // --- AUTH METHODS ---

  public async register(phone: string, name: string, pin: string) {
    const existing = this.state.users.find((u) => u.phone === phone);
    if (existing) {
      throw { status: 400, error: 'VALIDATION_ERROR', message: 'Phone number already registered' };
    }

    const userId = ++this.state.idCounter;
    const newUser: User & { pin: string } = {
      id: userId,
      phone,
      name,
      status: 'ACTIVE',
      role: 'USER',
      pin,
      totp_enrolled: false,
      created_at: new Date().toISOString(),
    };

    const userAcc: StoredAccount = { id: 80 + userId, user_id: userId, type: 'USER', balance: 10000000 };
    const holdAcc: StoredAccount = { id: 180 + userId, user_id: userId, type: 'HOLD', balance: 0 };

    // Debit mint, credit user
    const mintAcc = this.state.accounts.find((a) => a.type === 'SYSTEM_MINT')!;
    mintAcc.balance -= 10000000;

    const bonusTxnId = ++this.state.idCounter;
    const bonusTxn: Transaction = {
      id: bonusTxnId,
      ref: `TXN_${Date.now()}_MINT`,
      kind: 'SIGNUP_BONUS',
      state: 'COMPLETED',
      amount_paisa: 10000000,
      note: 'Welcome Signup Bonus',
      counterparty: { name: 'PSTUPay System', phone: 'SYSTEM' },
      created_at: new Date().toISOString(),
      can_reverse: false,
      entries: [
        { account_id: mintAcc.id, account_type: 'SYSTEM_MINT', amount_paisa: -10000000 },
        { account_id: userAcc.id, account_type: 'USER', amount_paisa: 10000000 },
      ],
    };

    this.state.users.push(newUser);
    this.state.accounts.push(userAcc, holdAcc);
    this.state.transactions.unshift(bonusTxn);

    this.saveState();

    return {
      user: { id: newUser.id, phone: newUser.phone, name: newUser.name, status: newUser.status, role: newUser.role },
      access_token: `mock_jwt_access_${userId}`,
      refresh_token: `mock_jwt_refresh_${userId}`,
      signup_bonus_paisa: 10000000,
      balance_paisa: 10000000,
    };
  }

  public async login(phone: string, pin: string) {
    const user = this.state.users.find((u) => u.phone === phone);
    if (!user) {
      throw { status: 401, error: 'UNAUTHENTICATED', message: 'Invalid phone or PIN', details: { attempts_remaining: 3 } };
    }
    if (user.pin !== pin) {
      throw { status: 401, error: 'UNAUTHENTICATED', message: 'Wrong PIN', details: { attempts_remaining: 2 } };
    }

    const userAcc = this.state.accounts.find((a) => a.user_id === user.id && a.type === 'USER');

    return {
      user: { id: user.id, phone: user.phone, name: user.name, status: user.status, role: user.role, totp_enrolled: user.totp_enrolled },
      access_token: `mock_jwt_access_${user.id}`,
      refresh_token: `mock_jwt_refresh_${user.id}`,
      balance_paisa: userAcc ? userAcc.balance : 0,
    };
  }

  public async getUser(userId: number): Promise<User> {
    const user = this.state.users.find((u) => u.id === userId);
    if (!user) throw { status: 404, error: 'USER_NOT_FOUND', message: 'User not found' };
    return { id: user.id, phone: user.phone, name: user.name, status: user.status, role: user.role, totp_enrolled: user.totp_enrolled };
  }

  public async lookupUser(phone: string) {
    const user = this.state.users.find((u) => u.phone === phone.replace(/\s+/g, ''));
    if (!user) {
      throw { status: 404, error: 'USER_NOT_FOUND', message: 'No user found' };
    }
    // Return first name + last initial per API.md
    const parts = user.name.split(' ');
    const initialName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];

    return {
      id: user.id,
      name: initialName,
      fullName: user.name,
      phone: user.phone,
      is_first_time: user.id === 45, // Nadia is first time demo
    };
  }

  // --- BALANCE & LIMITS ---

  public async getBalance(userId: number): Promise<BalanceResponse> {
    const userAcc = this.state.accounts.find((a) => a.user_id === userId && a.type === 'USER');
    const holdAcc = this.state.accounts.find((a) => a.user_id === userId && a.type === 'HOLD');

    const balance = userAcc ? userAcc.balance : 0;
    const held = holdAcc ? holdAcc.balance : 0;

    return {
      balance_paisa: balance + held,
      held_paisa: held,
      available_paisa: balance,
    };
  }

  public async getLimits(userId: number): Promise<LimitsResponse> {
    return {
      daily_limit_paisa: 5000000,
      spent_today_paisa: 250000,
      remaining_paisa: 4750000,
      resets_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    };
  }

  // --- TRANSFERS ---

  public async createTransfer(
    senderId: number,
    toPhone: string,
    amountPaisa: number,
    note?: string,
    idempotencyKey?: string,
    stepUpToken?: string
  ) {
    const sender = this.state.users.find((u) => u.id === senderId);
    if (!sender) throw { status: 401, error: 'UNAUTHENTICATED', message: 'User not found' };
    if (sender.status === 'FROZEN') {
      throw { status: 403, error: 'ACCOUNT_FROZEN', message: 'Your account is frozen. You can still receive money.' };
    }

    const receiver = this.state.users.find((u) => u.phone === toPhone.replace(/\s+/g, ''));
    if (!receiver) throw { status: 404, error: 'USER_NOT_FOUND', message: 'Recipient not found' };
    if (receiver.id === senderId) throw { status: 422, error: 'SELF_TRANSFER', message: 'Cannot transfer to self' };

    const senderUserAcc = this.state.accounts.find((a) => a.user_id === senderId && a.type === 'USER');
    const senderHoldAcc = this.state.accounts.find((a) => a.user_id === senderId && a.type === 'HOLD');
    const receiverUserAcc = this.state.accounts.find((a) => a.user_id === receiver.id && a.type === 'USER');

    if (!senderUserAcc || !senderHoldAcc || !receiverUserAcc) {
      throw { status: 500, error: 'INTERNAL_ERROR', message: 'Account records missing' };
    }

    if (senderUserAcc.balance < amountPaisa) {
      throw {
        status: 402,
        error: 'INSUFFICIENT_FUNDS',
        message: `Not enough balance. You have ৳${(senderUserAcc.balance / 100).toFixed(2)}.`,
        details: { balance_paisa: senderUserAcc.balance, required_paisa: amountPaisa },
      };
    }

    // Step-up check (>৳20,000 or first time)
    if ((amountPaisa > 2000000 || receiver.id === 45) && !stepUpToken) {
      throw { status: 403, error: 'STEP_UP_REQUIRED', message: 'Step-up authentication required', details: { reason: 'FIRST_TIME_RECIPIENT' } };
    }

    const isHold = amountPaisa >= 500000; // ৳5,000+ enters hold state
    const txnId = ++this.state.idCounter;
    const ref = `TXN_01J8_${Date.now()}`;

    if (isHold) {
      // Deduct from USER acc, credit to HOLD acc
      senderUserAcc.balance -= amountPaisa;
      senderHoldAcc.balance += amountPaisa;

      const settleAfter = new Date(Date.now() + 60 * 1000).toISOString();

      const txn: Transaction = {
        id: txnId,
        ref,
        kind: 'TRANSFER',
        state: 'HELD',
        amount_paisa: amountPaisa,
        note: note || '',
        settle_after: settleAfter,
        can_cancel_until: settleAfter,
        counterparty: { id: receiver.id, name: receiver.name, phone: receiver.phone },
        created_at: new Date().toISOString(),
        entries: [
          { account_id: senderUserAcc.id, account_type: 'USER', amount_paisa: -amountPaisa },
          { account_id: senderHoldAcc.id, account_type: 'HOLD', amount_paisa: amountPaisa },
        ],
      };

      this.state.transactions.unshift(txn);
      this.saveState();

      this.emit('txn.held', { txn });

      return {
        statusCode: 202,
        transaction: txn,
        balance_paisa: senderUserAcc.balance + senderHoldAcc.balance,
        can_cancel_until: settleAfter,
      };
    } else {
      // Immediate transfer
      senderUserAcc.balance -= amountPaisa;
      receiverUserAcc.balance += amountPaisa;

      const txn: Transaction = {
        id: txnId,
        ref,
        kind: 'TRANSFER',
        state: 'COMPLETED',
        amount_paisa: amountPaisa,
        note: note || '',
        can_reverse: true,
        counterparty: { id: receiver.id, name: receiver.name, phone: receiver.phone },
        created_at: new Date().toISOString(),
        entries: [
          { account_id: senderUserAcc.id, account_type: 'USER', amount_paisa: -amountPaisa },
          { account_id: receiverUserAcc.id, account_type: 'USER', amount_paisa: amountPaisa },
        ],
      };

      this.state.transactions.unshift(txn);
      this.saveState();

      this.emit('txn.completed', { txn });

      return {
        statusCode: 201,
        transaction: txn,
        balance_paisa: senderUserAcc.balance,
        entries: txn.entries,
      };
    }
  }

  public async cancelHoldTransfer(userId: number, txnId: number) {
    const txn = this.state.transactions.find((t) => t.id === txnId);
    if (!txn || txn.state !== 'HELD') {
      throw { status: 409, error: 'INVALID_STATE', message: 'Too late — that transfer already sent or was cancelled.' };
    }

    const senderUserAcc = this.state.accounts.find((a) => a.user_id === userId && a.type === 'USER');
    const senderHoldAcc = this.state.accounts.find((a) => a.user_id === userId && a.type === 'HOLD');

    if (senderUserAcc && senderHoldAcc) {
      senderHoldAcc.balance -= txn.amount_paisa;
      senderUserAcc.balance += txn.amount_paisa;
    }

    txn.state = 'CANCELLED';
    txn.settle_after = null;
    txn.can_cancel_until = null;

    this.saveState();
    this.emit('txn.cancelled', { txn });

    return { transaction: txn, balance_paisa: senderUserAcc ? senderUserAcc.balance : 0 };
  }

  // --- REVERSALS & DISPUTES ---

  public async reverseTransaction(userId: number, txnId: number, reason: string) {
    const orig = this.state.transactions.find((t) => t.id === txnId);
    if (!orig) throw { status: 404, error: 'TXN_NOT_FOUND', message: 'Transaction not found' };
    if (orig.reverses_txn_id || orig.state === 'REVERSED') {
      throw { status: 409, error: 'INVALID_STATE', message: 'This transaction was already reversed.' };
    }

    const receiver = this.state.users.find((u) => u.phone === orig.counterparty?.phone);
    if (!receiver) throw { status: 404, error: 'USER_NOT_FOUND', message: 'Counterparty not found' };

    const receiverUserAcc = this.state.accounts.find((a) => a.user_id === receiver.id && a.type === 'USER');
    const senderUserAcc = this.state.accounts.find((a) => a.user_id === userId && a.type === 'USER');

    if (!receiverUserAcc || !senderUserAcc) throw { status: 500, error: 'INTERNAL_ERROR', message: 'Accounts missing' };

    if (receiverUserAcc.balance < orig.amount_paisa) {
      throw {
        status: 402,
        error: 'INSUFFICIENT_FUNDS',
        message: `${orig.counterparty?.name || 'Receiver'} has already spent this money. Raise a dispute instead.`,
      };
    }

    receiverUserAcc.balance -= orig.amount_paisa;
    senderUserAcc.balance += orig.amount_paisa;

    orig.state = 'REVERSED';
    orig.can_reverse = false;

    const reversalTxnId = ++this.state.idCounter;
    const reversalTxn: Transaction = {
      id: reversalTxnId,
      ref: `TXN_${Date.now()}_REV`,
      kind: 'REVERSAL',
      state: 'COMPLETED',
      amount_paisa: orig.amount_paisa,
      note: `Reversed: ${orig.note || orig.ref}`,
      reverses_txn_id: orig.id,
      counterparty: orig.counterparty,
      created_at: new Date().toISOString(),
      can_reverse: false,
      entries: [
        { account_id: receiverUserAcc.id, account_type: 'USER', amount_paisa: -orig.amount_paisa },
        { account_id: senderUserAcc.id, account_type: 'USER', amount_paisa: orig.amount_paisa },
      ],
    };

    this.state.transactions.unshift(reversalTxn);
    this.saveState();

    this.emit('txn.reversed', { reversal: reversalTxn, original: orig });
    return { reversal: reversalTxn, original: orig };
  }

  public async raiseDispute(userId: number, txnId: number, reason: string) {
    const existing = this.state.disputes.find((d) => d.txn_id === txnId && d.state === 'OPEN');
    if (existing) {
      throw { status: 409, error: 'DISPUTE_ALREADY_OPEN', message: 'A dispute is already open on this transaction.' };
    }

    const txn = this.state.transactions.find((t) => t.id === txnId);
    if (!txn) throw { status: 404, error: 'TXN_NOT_FOUND', message: 'Transaction not found' };

    const user = this.state.users.find((u) => u.id === userId);

    const disputeId = ++this.state.idCounter;
    const dispute: Dispute = {
      id: disputeId,
      txn_id: txnId,
      state: 'OPEN',
      reason,
      raised_by: { id: userId, name: user ? user.name : 'User', role: 'sender' },
      transaction: {
        id: txn.id,
        ref: txn.ref,
        amount_paisa: txn.amount_paisa,
        state: txn.state,
        created_at: txn.created_at,
      },
      counterparty: { id: txn.counterparty?.id || 0, name: txn.counterparty?.name || 'Counterparty' },
      reversible_now: true,
      attempts: 0,
      last_attempt_error: null,
      created_at: new Date().toISOString(),
    };

    txn.disputed = true;
    this.state.disputes.unshift(dispute);
    this.saveState();

    this.emit('dispute.raised', { dispute });
    return dispute;
  }

  // --- MONEY REQUESTS ---

  public async createMoneyRequest(fromUserId: number, toPhone: string, amountPaisa: number, note?: string) {
    const requester = this.state.users.find((u) => u.id === fromUserId);
    const payer = this.state.users.find((u) => u.phone === toPhone.replace(/\s+/g, ''));

    if (!requester || !payer) throw { status: 404, error: 'USER_NOT_FOUND', message: 'Recipient phone not found' };

    const reqId = ++this.state.idCounter;
    const req: MoneyRequest = {
      id: reqId,
      from_user_id: fromUserId,
      to_user_id: payer.id,
      state: 'PENDING',
      amount_paisa: amountPaisa,
      note: note || '',
      requester: { id: requester.id, name: requester.name, phone: requester.phone },
      payer: { id: payer.id, name: payer.name, phone: payer.phone },
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    };

    this.state.moneyRequests.unshift(req);
    this.saveState();

    this.emit('request.created', { request: req });
    return req;
  }

  public async payMoneyRequest(payerId: number, reqId: number) {
    const req = this.state.moneyRequests.find((r) => r.id === reqId);
    if (!req || req.state !== 'PENDING') {
      throw { status: 409, error: 'INVALID_STATE', message: 'This request is no longer pending.' };
    }

    // Execute transfer
    const res = await this.createTransfer(payerId, req.requester?.phone || '', req.amount_paisa, `Paid: ${req.note || 'Request'}`);
    req.state = 'PAID';

    this.saveState();
    this.emit('request.settled', { request: req, transfer: res });
    return res;
  }

  public async declineMoneyRequest(userId: number, reqId: number) {
    const req = this.state.moneyRequests.find((r) => r.id === reqId);
    if (!req || req.state !== 'PENDING') {
      throw { status: 409, error: 'INVALID_STATE', message: 'Request already handled or expired.' };
    }
    req.state = 'DECLINED';
    this.saveState();
    this.emit('request.declined', { request: req });
    return req;
  }

  public async cancelMoneyRequest(userId: number, reqId: number) {
    const req = this.state.moneyRequests.find((r) => r.id === reqId);
    if (!req || req.state !== 'PENDING') {
      throw { status: 409, error: 'INVALID_STATE', message: 'Request already handled or expired.' };
    }
    req.state = 'CANCELLED';
    this.saveState();
    return req;
  }

  // --- QUERY APIS ---

  public async getTransactions(userId: number, limit = 20, cursor?: number, direction = 'all'): Promise<{ items: Transaction[]; next_cursor: number | null; has_more: boolean }> {
    const user = this.state.users.find((u) => u.id === userId);
    const userPhone = user ? user.phone : '';

    let list = this.state.transactions.filter((t) => {
      if (direction === 'sent') return t.counterparty?.phone !== userPhone;
      if (direction === 'received') return t.counterparty?.phone === userPhone;
      if (direction === 'reversals') return t.kind === 'REVERSAL';
      return true;
    });

    if (cursor) {
      const idx = list.findIndex((t) => t.id <= cursor);
      if (idx !== -1) {
        list = list.slice(idx);
      }
    }

    const items = list.slice(0, limit);
    const has_more = list.length > limit;
    const next_cursor = has_more && items.length > 0 ? items[items.length - 1].id : null;

    return { items, next_cursor, has_more };
  }

  public async getTransaction(id: number): Promise<Transaction> {
    const txn = this.state.transactions.find((t) => t.id === id);
    if (!txn) throw { status: 404, error: 'TXN_NOT_FOUND', message: 'Transaction not found' };
    return txn;
  }

  public async getMoneyRequests(userId: number, type: 'incoming' | 'outgoing'): Promise<MoneyRequest[]> {
    if (type === 'incoming') {
      return this.state.moneyRequests.filter((r) => r.to_user_id === userId);
    } else {
      return this.state.moneyRequests.filter((r) => r.from_user_id === userId);
    }
  }

  public async getDisputes(userId?: number): Promise<Dispute[]> {
    if (userId) {
      return this.state.disputes.filter((d) => d.raised_by?.id === userId);
    }
    return this.state.disputes;
  }

  public async getNotifications(): Promise<NotificationItem[]> {
    return this.state.notifications;
  }

  // --- ADMIN METHODS ---

  public async getIntegrityReport(): Promise<IntegrityCheckReport> {
    // Conservation: sum of all entries must be 0
    let totalPaisa = 0;
    this.state.accounts.forEach((a) => {
      totalPaisa += a.balance;
    });

    const negativeAccounts = this.state.accounts
      .filter((a) => a.type !== 'SYSTEM_MINT' && a.balance < 0)
      .map((a) => ({ account_id: a.id, balance_paisa: a.balance }));

    return {
      conservation: { pass: totalPaisa === 0, total_paisa: totalPaisa },
      balance_drift: { pass: true, accounts_checked: this.state.accounts.length, drifted: [] },
      negative: { pass: negativeAccounts.length === 0, accounts: negativeAccounts },
      chain: { pass: true, verified_to_entry_id: 40188 + this.state.transactions.length },
      checked_at: new Date().toISOString(),
    };
  }

  public async getSystemHealth(): Promise<SystemHealth> {
    return {
      db: { ok: true, latency_ms: 1.2 },
      pgbouncer: { ok: true, cl_active: 14, sv_active: 6, pool_size: 50 },
      kafka: { ok: true, consumer_lag: 0 },
      redis: { ok: true, hit_rate: 0.984, keys: 1204 },
      outbox: { unprocessed: 0, dead_letter: 0, oldest_unprocessed_age_s: null },
    };
  }

  public async getSystemMetrics(): Promise<SystemMetrics> {
    return {
      tps: 1840,
      p95_latency_ms: 24,
      active_locks: 8,
      connections: 34,
    };
  }

  public async runLoadTest(): Promise<LoadTestResult> {
    return {
      duration_ms: 2717,
      tps: 1840,
      p95_latency_ms: 24,
      supply_before_paisa: 2000000000,
      supply_after_paisa: 2000000000,
      supply_unchanged: true,
      negative_balances: 0,
      failed: 0,
      deadlocks: 0,
    };
  }

  public async resolveDispute(disputeId: number, action: 'REVERSE' | 'REJECT', resolution: string) {
    const dispute = this.state.disputes.find((d) => d.id === disputeId);
    if (!dispute || dispute.state !== 'OPEN') {
      throw { status: 409, error: 'INVALID_STATE', message: 'Dispute is not open' };
    }

    if (action === 'REJECT') {
      dispute.state = 'REJECTED';
      dispute.resolution = resolution;
      dispute.resolved_at = new Date().toISOString();
      this.saveState();
      return { dispute };
    }

    // Action === REVERSE
    const txn = this.state.transactions.find((t) => t.id === dispute.txn_id);
    if (!txn) throw { status: 404, error: 'TXN_NOT_FOUND', message: 'Transaction not found' };

    const receiver = this.state.users.find((u) => u.name === dispute.counterparty?.name || u.phone === txn.counterparty?.phone);
    const receiverUserAcc = receiver ? this.state.accounts.find((a) => a.user_id === receiver.id && a.type === 'USER') : null;

    if (receiverUserAcc && receiverUserAcc.balance < txn.amount_paisa) {
      dispute.attempts = (dispute.attempts || 0) + 1;
      dispute.last_attempt_error = `Receiver balance is ৳${(receiverUserAcc.balance / 100).toFixed(2)}`;
      this.saveState();
      throw {
        status: 402,
        error: 'INSUFFICIENT_FUNDS',
        message: `Reversal failed — receiver's balance is ৳${(receiverUserAcc.balance / 100).toFixed(2)}. Retry later or reject.`,
        details: { dispute_state: 'OPEN', attempts: dispute.attempts },
      };
    }

    // Execute reversal
    dispute.state = 'REVERSED';
    dispute.resolution = resolution;
    dispute.resolved_at = new Date().toISOString();

    const senderUserAcc = this.state.accounts.find((a) => a.user_id === dispute.raised_by?.id && a.type === 'USER');
    if (receiverUserAcc && senderUserAcc) {
      receiverUserAcc.balance -= txn.amount_paisa;
      senderUserAcc.balance += txn.amount_paisa;
    }

    const reversalTxnId = ++this.state.idCounter;
    const reversalTxn: Transaction = {
      id: reversalTxnId,
      ref: `TXN_${Date.now()}_ADMIN_REV`,
      kind: 'REVERSAL',
      state: 'COMPLETED',
      amount_paisa: txn.amount_paisa,
      note: `Admin Reversal: ${resolution}`,
      reverses_txn_id: txn.id,
      counterparty: txn.counterparty,
      created_at: new Date().toISOString(),
      can_reverse: false,
    };

    this.state.transactions.unshift(reversalTxn);
    this.saveState();

    this.emit('dispute.resolved', { dispute, reversal: reversalTxn });
    return { dispute, reversal: reversalTxn };
  }

  public async freezeAccount(phone: string, reason: string) {
    const user = this.state.users.find((u) => u.phone === phone);
    if (!user) throw { status: 404, error: 'USER_NOT_FOUND', message: 'User not found' };
    user.status = 'FROZEN';
    this.saveState();
    return user;
  }

  public async unfreezeAccount(phone: string, reason: string) {
    const user = this.state.users.find((u) => u.phone === phone);
    if (!user) throw { status: 404, error: 'USER_NOT_FOUND', message: 'User not found' };
    user.status = 'ACTIVE';
    this.saveState();
    return user;
  }

  public async rebuildBalance(userId: number) {
    const userAcc = this.state.accounts.find((a) => a.user_id === userId && a.type === 'USER');
    const before = userAcc ? userAcc.balance : 0;
    return {
      before_paisa: before,
      after_paisa: before,
      drift_paisa: 0,
      message: 'Verified 100% against ledger entries. Zero drift.',
    };
  }
}

export const mockEngine = new MockEngine();
