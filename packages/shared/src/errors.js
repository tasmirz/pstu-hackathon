"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VelocityExceeded = exports.LedgerIntegrityError = exports.AccountLocked = exports.SelfTransfer = exports.IdempotencyKeyReuse = exports.DisputeWindowClosed = exports.DisputeAlreadyOpen = exports.InvalidState = exports.RequestNotFound = exports.BillShareNotFound = exports.BillNotFound = exports.TxnNotFound = exports.UserNotFound = exports.NotAParty = exports.DailyLimitExceeded = exports.AccountFrozen = exports.StepUpRequired = exports.InsufficientFunds = exports.TokenReuseDetected = exports.Unauthenticated = exports.ValidationError = exports.AppError = void 0;
const money_1 = require("./money");
class AppError extends Error {
    constructor(httpStatus, code, message, details) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.details = details;
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
exports.AppError = AppError;
class ValidationError extends AppError {
    constructor(message, details) {
        super(400, 'VALIDATION_ERROR', message, details);
    }
}
exports.ValidationError = ValidationError;
class Unauthenticated extends AppError {
    constructor(message = 'Missing or invalid access token', details) {
        super(401, 'UNAUTHENTICATED', message, details);
    }
}
exports.Unauthenticated = Unauthenticated;
class TokenReuseDetected extends AppError {
    constructor() {
        super(401, 'TOKEN_REUSE_DETECTED', 'Refresh token already used; the session family has been revoked');
    }
}
exports.TokenReuseDetected = TokenReuseDetected;
class InsufficientFunds extends AppError {
    constructor(balancePaisa, requiredPaisa) {
        super(402, 'INSUFFICIENT_FUNDS', `Balance is ${(0, money_1.taka)(balancePaisa)}, need ${(0, money_1.taka)(requiredPaisa)}`, {
            balance_paisa: balancePaisa,
            required_paisa: requiredPaisa,
        });
    }
}
exports.InsufficientFunds = InsufficientFunds;
class StepUpRequired extends AppError {
    constructor(reason) {
        super(403, 'STEP_UP_REQUIRED', 'This action requires step-up authentication', { reason });
    }
}
exports.StepUpRequired = StepUpRequired;
class AccountFrozen extends AppError {
    constructor() {
        super(403, 'ACCOUNT_FROZEN', 'This account is frozen and cannot send money');
    }
}
exports.AccountFrozen = AccountFrozen;
class DailyLimitExceeded extends AppError {
    constructor(details) {
        super(403, 'DAILY_LIMIT_EXCEEDED', 'This transfer would exceed your daily send limit', details);
    }
}
exports.DailyLimitExceeded = DailyLimitExceeded;
class NotAParty extends AppError {
    constructor() {
        super(403, 'NOT_A_PARTY', 'Only the sender or receiver may act on this transaction');
    }
}
exports.NotAParty = NotAParty;
class UserNotFound extends AppError {
    constructor() {
        super(404, 'USER_NOT_FOUND', 'User not found');
    }
}
exports.UserNotFound = UserNotFound;
class TxnNotFound extends AppError {
    constructor() {
        super(404, 'TXN_NOT_FOUND', 'Transaction not found');
    }
}
exports.TxnNotFound = TxnNotFound;
class BillNotFound extends AppError {
    constructor() {
        super(404, 'BILL_NOT_FOUND', 'Bill not found');
    }
}
exports.BillNotFound = BillNotFound;
class BillShareNotFound extends AppError {
    constructor() {
        super(404, 'BILL_SHARE_NOT_FOUND', 'You have no share on this bill');
    }
}
exports.BillShareNotFound = BillShareNotFound;
class RequestNotFound extends AppError {
    constructor() {
        super(404, 'REQUEST_NOT_FOUND', 'Money request not found');
    }
}
exports.RequestNotFound = RequestNotFound;
class InvalidState extends AppError {
    constructor(message = 'That action is no longer valid for this resource’s current state') {
        super(409, 'INVALID_STATE', message);
    }
}
exports.InvalidState = InvalidState;
class DisputeAlreadyOpen extends AppError {
    constructor() {
        super(409, 'DISPUTE_ALREADY_OPEN', 'A dispute is already open on this transaction');
    }
}
exports.DisputeAlreadyOpen = DisputeAlreadyOpen;
class DisputeWindowClosed extends AppError {
    constructor() {
        super(422, 'DISPUTE_WINDOW_CLOSED', 'This transaction is older than the 7-day dispute window');
    }
}
exports.DisputeWindowClosed = DisputeWindowClosed;
class IdempotencyKeyReuse extends AppError {
    constructor() {
        super(422, 'IDEMPOTENCY_KEY_REUSE', 'This idempotency key was already used with a different request body');
    }
}
exports.IdempotencyKeyReuse = IdempotencyKeyReuse;
class SelfTransfer extends AppError {
    constructor() {
        super(422, 'SELF_TRANSFER', 'Sender and receiver cannot be the same account');
    }
}
exports.SelfTransfer = SelfTransfer;
class AccountLocked extends AppError {
    constructor(lockedUntil) {
        super(423, 'ACCOUNT_LOCKED', 'Too many failed PIN attempts', { locked_until: lockedUntil });
    }
}
exports.AccountLocked = AccountLocked;
class LedgerIntegrityError extends AppError {
    constructor(message) {
        super(500, 'LEDGER_INTEGRITY_ERROR', message);
    }
}
exports.LedgerIntegrityError = LedgerIntegrityError;
class VelocityExceeded extends AppError {
    constructor() {
        super(429, 'VELOCITY_EXCEEDED', 'Too many transactions per minute; re-enter your PIN to continue');
    }
}
exports.VelocityExceeded = VelocityExceeded;
//# sourceMappingURL=errors.js.map