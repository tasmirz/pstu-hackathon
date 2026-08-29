import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '@pstu/shared';
import { AuthedRequest } from './jwt-auth.guard';

/** Apply after JwtAuthGuard. Every mutating admin action also writes to
 * ledger.audit_log with actor/before/after/reason (API.md "Admin"). */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user?.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'This action requires the ADMIN role');
    }
    return true;
  }
}
