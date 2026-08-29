import { taka } from './money';

/**
 * Every stable machine error code in API.md, as a typed exception. Services
 * throw these; each app wires one Nest exception filter that serializes
 * `{ error, message, details }` at the right HTTP status. Never hand-roll a
 * `res.status().json()` for an error — going through here keeps the wire
 * shape identical across all three services.
 */
export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class Unauthenticated extends AppError {
  constructor(message = 'Missing or invalid access token', details?: Record<string, unknown>) {
    super(401, 'UNAUTHENTICATED', message, details);
  }
}

export class TokenReuseDetected extends AppError {
  constructor() {
    super(401, 'TOKEN_REUSE_DETECTED', 'Refresh token already used; the session family has been revoked');
  }
}

export class InsufficientFunds extends AppError {
  constructor(balancePaisa: number, requiredPaisa: number) {
    super(402, 'INSUFFICIENT_FUNDS', `Balance is ${taka(balancePaisa)}, need ${taka(requiredPaisa)}`, {
      balance_paisa: balancePaisa,
      required_paisa: requiredPaisa,
    });
  }
}

export class StepUpRequired extends AppError {
  constructor(reason: string) {
    super(403, 'STEP_UP_REQUIRED', 'This action requires step-up authentication', { reason });
  }
}

export class AccountFrozen extends AppError {
  constructor() {
    super(403, 'ACCOUNT_FROZEN', 'This account is frozen and cannot send money');
  }
}

export class DailyLimitExceeded extends AppError {
  constructor(details: Record<string, unknown>) {
    super(403, 'DAILY_LIMIT_EXCEEDED', 'This transfer would exceed your daily send limit', details);
  }
}

export class NotAParty extends AppError {
  constructor() {
    super(403, 'NOT_A_PARTY', 'Only the sender or receiver may act on this transaction');
  }
}

export class UserNotFound extends AppError {
  constructor() {
    super(404, 'USER_NOT_FOUND', 'User not found');
  }
}

export class TxnNotFound extends AppError {
  constructor() {
    super(404, 'TXN_NOT_FOUND', 'Transaction not found');
  }
}

export class BillNotFound extends AppError {
  constructor() {
    super(404, 'BILL_NOT_FOUND', 'Bill not found');
  }
}

export class BillShareNotFound extends AppError {
  constructor() {
    super(404, 'BILL_SHARE_NOT_FOUND', 'You have no share on this bill');
  }
}

export class RequestNotFound extends AppError {
  constructor() {
    super(404, 'REQUEST_NOT_FOUND', 'Money request not found');
  }
}

export class InvalidState extends AppError {
  constructor(message = 'That action is no longer valid for this resource’s current state') {
    super(409, 'INVALID_STATE', message);
  }
}

export class DisputeAlreadyOpen extends AppError {
  constructor() {
    super(409, 'DISPUTE_ALREADY_OPEN', 'A dispute is already open on this transaction');
  }
}

export class DisputeWindowClosed extends AppError {
  constructor() {
    super(422, 'DISPUTE_WINDOW_CLOSED', 'This transaction is older than the 7-day dispute window');
  }
}

export class IdempotencyKeyReuse extends AppError {
  constructor() {
    super(422, 'IDEMPOTENCY_KEY_REUSE', 'This idempotency key was already used with a different request body');
  }
}

export class SelfTransfer extends AppError {
  constructor() {
    super(422, 'SELF_TRANSFER', 'Sender and receiver cannot be the same account');
  }
}

export class AccountLocked extends AppError {
  constructor(lockedUntil: string) {
    super(423, 'ACCOUNT_LOCKED', 'Too many failed PIN attempts', { locked_until: lockedUntil });
  }
}

export class VelocityExceeded extends AppError {
  constructor() {
    super(429, 'VELOCITY_EXCEEDED', 'Too many transactions per minute; re-enter your PIN to continue');
  }
}
