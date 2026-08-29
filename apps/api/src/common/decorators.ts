import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ValidationError } from '@pstu/shared';
import { AuthedRequest } from './guards/jwt-auth.guard';

/** Every mutating money endpoint requires this header (API.md "Idempotency"). */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const key = req.headers['idempotency-key'];
  if (!key || typeof key !== 'string' || key.length < 8) {
    throw new ValidationError('Idempotency-Key header is required for this endpoint');
  }
  return key;
});

/** Present only when the client already completed a step-up challenge. */
export const StepUpToken = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest();
  const token = req.headers['x-step-up-token'];
  return typeof token === 'string' ? token : undefined;
});

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
