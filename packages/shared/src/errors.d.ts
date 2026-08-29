export declare class AppError extends Error {
    readonly httpStatus: number;
    readonly code: string;
    readonly details?: Record<string, unknown> | undefined;
    constructor(httpStatus: number, code: string, message: string, details?: Record<string, unknown> | undefined);
    toJSON(): {
        details?: Record<string, unknown> | undefined;
        error: string;
        message: string;
    };
}
export declare class ValidationError extends AppError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class Unauthenticated extends AppError {
    constructor(message?: string, details?: Record<string, unknown>);
}
export declare class TokenReuseDetected extends AppError {
    constructor();
}
export declare class InsufficientFunds extends AppError {
    constructor(balancePaisa: number, requiredPaisa: number);
}
export declare class StepUpRequired extends AppError {
    constructor(reason: string);
}
export declare class AccountFrozen extends AppError {
    constructor();
}
export declare class DailyLimitExceeded extends AppError {
    constructor(details: Record<string, unknown>);
}
export declare class NotAParty extends AppError {
    constructor();
}
export declare class UserNotFound extends AppError {
    constructor();
}
export declare class TxnNotFound extends AppError {
    constructor();
}
export declare class BillNotFound extends AppError {
    constructor();
}
export declare class BillShareNotFound extends AppError {
    constructor();
}
export declare class RequestNotFound extends AppError {
    constructor();
}
export declare class InvalidState extends AppError {
    constructor(message?: string);
}
export declare class DisputeAlreadyOpen extends AppError {
    constructor();
}
export declare class DisputeWindowClosed extends AppError {
    constructor();
}
export declare class IdempotencyKeyReuse extends AppError {
    constructor();
}
export declare class SelfTransfer extends AppError {
    constructor();
}
export declare class AccountLocked extends AppError {
    constructor(lockedUntil: string);
}
export declare class LedgerIntegrityError extends AppError {
    constructor(message: string);
}
export declare class VelocityExceeded extends AppError {
    constructor();
}
