import { StepUpRequired, verifyStepUpToken } from '@pstu/shared';
import { config } from '../config';

/**
 * Centralizes every "does this action need X-Step-Up-Token" rule from
 * API.md's "Step-up authentication" table, so each call site states its own
 * rule instead of re-deriving the threshold. First-ever-recipient is the one
 * exception — it needs a ledger read to know, so it stays inline in
 * TransferService rather than living here.
 */
export function requireStepUp(opts: {
  userId: number;
  token?: string;
  reason: string;
  always?: boolean;
  amountPaisa?: number;
}) {
  const needsIt = opts.always || (opts.amountPaisa !== undefined && opts.amountPaisa > config.stepUpAmountThresholdPaisa);
  if (!needsIt) return;

  const valid =
    !!opts.token &&
    (() => {
      try {
        return verifyStepUpToken(config.jwtPublicKey, opts.token!).sub === opts.userId;
      } catch {
        return false;
      }
    })();

  if (!valid) throw new StepUpRequired(opts.reason);
}
