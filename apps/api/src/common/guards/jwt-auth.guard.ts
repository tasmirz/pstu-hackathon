import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Pool } from 'pg';
import { Unauthenticated, verifyAccessToken } from '@pstu/shared';
import { config } from '../../config';
import { AUTH_POOL } from '../../db/db.module';

export interface AuthedRequest extends Request {
  user: { id: number; role: 'USER' | 'ADMIN'; tv: number };
}

/**
 * Verifies the RS256 access token and checks token_version against the DB,
 * so `logout-all` (which bumps token_version) invalidates outstanding
 * access tokens immediately rather than waiting out their 15-minute expiry
 * (SIMULATOR.md AUTH-04). One indexed PK lookup on auth.users — the same
 * cost class PLAN.md argues the balance lookup is, i.e. cheap enough not to
 * bother caching.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_POOL) private readonly authPool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) throw new Unauthenticated();

    const token = header.slice('Bearer '.length);
    let claims;
    try {
      claims = verifyAccessToken(config.jwtPublicKey, token);
    } catch {
      throw new Unauthenticated('Access token is missing, expired, or invalid');
    }

    const { rows } = await this.authPool.query(`SELECT token_version, role FROM auth.users WHERE id = $1`, [
      claims.sub,
    ]);
    if (!rows[0] || rows[0].token_version !== claims.tv) {
      throw new Unauthenticated('Session revoked — please log in again');
    }

    req.user = { id: claims.sub, role: rows[0].role, tv: claims.tv };
    return true;
  }
}
