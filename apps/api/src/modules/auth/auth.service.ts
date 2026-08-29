import { Inject, Injectable } from '@nestjs/common';
import {
  AccountLocked,
  AppError,
  LedgerIntegrityError,
  newTxnRef,
  sha256,
  signAccessToken,
  signStepUpToken,
  TokenReuseDetected,
  Unauthenticated,
  UserNotFound,
  ValidationError,
  withTransaction,
} from '@pstu/shared';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Pool, PoolClient } from 'pg';
import { config } from '../../config';
import { AUTH_POOL } from '../../db/db.module';
import { LoginDto, RegisterDto, StepUpDto } from './dto';

type Role = 'USER' | 'ADMIN';

interface TokenUser {
  id: number;
  token_version: number;
  role: Role;
}

interface PublicUser extends TokenUser {
  phone: string;
  name: string;
  status: 'ACTIVE' | 'FROZEN';
}

@Injectable()
export class AuthService {
  constructor(@Inject(AUTH_POOL) private readonly pool: Pool) {}

  private newRefreshToken() {
    return `rt_${randomBytes(32).toString('base64url')}`;
  }

  private async issueTokenPair(client: PoolClient, user: TokenUser, familyId: string = randomUUID()) {
    const refreshToken = this.newRefreshToken();
    await client.query(
      `INSERT INTO auth.refresh_tokens (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 day'))`,
      [user.id, sha256(refreshToken), familyId, config.refreshTokenTtlDays],
    );
    return {
      access_token: signAccessToken(config.jwtPrivateKey, {
        sub: user.id,
        tv: user.token_version,
        role: user.role,
      }),
      refresh_token: refreshToken,
    };
  }

  async register(dto: RegisterDto) {
    const pinHash = await bcrypt.hash(dto.pin, config.bcryptCost);

    try {
      return await withTransaction(this.pool, async (client) => {
        const inserted = await client.query<PublicUser>(
          `INSERT INTO auth.users (phone, name, pin_hash)
           VALUES ($1, $2, $3)
           RETURNING id, phone, name, status, token_version, role`,
          [dto.phone, dto.name.trim(), pinHash],
        );
        const user = inserted.rows[0];

        const account = await client.query<{ id: number }>(
          `INSERT INTO ledger.accounts (user_id, type, balance)
           VALUES ($1, 'USER', 0) RETURNING id`,
          [user.id],
        );
        const mint = await client.query<{ id: number }>(
          `SELECT id FROM ledger.accounts WHERE type = 'SYSTEM_MINT'`,
        );
        if (!mint.rows[0]) {
          throw new LedgerIntegrityError('System mint account is missing');
        }

        const transaction = await client.query<{ id: number; ref: string }>(
          `INSERT INTO ledger.transactions
             (ref, kind, state, sender_id, receiver_id, amount, note)
           VALUES ($1, 'SIGNUP_BONUS', 'COMPLETED', NULL, $2, $3, 'Signup bonus')
           RETURNING id, ref`,
          [newTxnRef(), user.id, config.signupBonusPaisa],
        );
        const txn = transaction.rows[0];

        await client.query(
          `INSERT INTO ledger.entries (txn_id, account_id, amount)
           VALUES ($1, $2, $3), ($1, $4, $5)`,
          [txn.id, mint.rows[0].id, -config.signupBonusPaisa, account.rows[0].id, config.signupBonusPaisa],
        );
        await client.query(
          `UPDATE ledger.accounts
              SET balance = balance + CASE WHEN id = $1 THEN $3::bigint ELSE $4::bigint END
            WHERE id IN ($1, $2)`,
          [mint.rows[0].id, account.rows[0].id, -config.signupBonusPaisa, config.signupBonusPaisa],
        );
        await client.query(
          `INSERT INTO ledger.outbox (topic, payload) VALUES ('txn.completed', $1::jsonb)`,
          [JSON.stringify({ txn_id: txn.id, ref: txn.ref, kind: 'SIGNUP_BONUS', receiver_id: user.id })],
        );

        const tokens = await this.issueTokenPair(client, user);
        return {
          user: { id: user.id, phone: user.phone, name: user.name, status: user.status },
          ...tokens,
          signup_bonus_paisa: config.signupBonusPaisa,
          balance_paisa: config.signupBonusPaisa,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ValidationError('That phone number is already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const outcome = await withTransaction(this.pool, async (client) => {
      const found = await client.query<PublicUser & { pin_hash: string; locked_until: Date | null; failed_pin_attempts: number }>(
        `SELECT id, phone, name, status, token_version, role, pin_hash,
                locked_until, failed_pin_attempts
           FROM auth.users WHERE phone = $1 FOR UPDATE`,
        [dto.phone],
      );
      const user = found.rows[0];
      if (!user) throw new Unauthenticated('Invalid phone number or PIN');

      if (user.locked_until && user.locked_until.getTime() > Date.now()) {
        throw new AccountLocked(user.locked_until.toISOString());
      }

      if (!(await bcrypt.compare(dto.pin, user.pin_hash))) {
        const attempts = user.failed_pin_attempts + 1;
        if (attempts >= config.failedPinLockoutThreshold) {
          const locked = await client.query<{ locked_until: Date }>(
            `UPDATE auth.users
                SET failed_pin_attempts = 0,
                    locked_until = now() + ($2 * interval '1 minute')
              WHERE id = $1 RETURNING locked_until`,
            [user.id, config.lockoutMinutes],
          );
          return { kind: 'locked' as const, lockedUntil: locked.rows[0].locked_until.toISOString() };
        }
        await client.query(
          `UPDATE auth.users SET failed_pin_attempts = $2, locked_until = NULL WHERE id = $1`,
          [user.id, attempts],
        );
        return { kind: 'wrong-pin' as const, attemptsRemaining: config.failedPinLockoutThreshold - attempts };
      }

      await client.query(
        `UPDATE auth.users SET failed_pin_attempts = 0, locked_until = NULL WHERE id = $1`,
        [user.id],
      );
      const tokens = await this.issueTokenPair(client, user);
      return {
        kind: 'success' as const,
        response: {
          ...tokens,
          user: { id: user.id, phone: user.phone, name: user.name, status: user.status },
        },
      };
    });

    if (outcome.kind === 'locked') throw new AccountLocked(outcome.lockedUntil);
    if (outcome.kind === 'wrong-pin') {
      throw new Unauthenticated('Invalid phone number or PIN', { attempts_remaining: outcome.attemptsRemaining });
    }
    return outcome.response;
  }

  async refresh(rawToken: string) {
    const outcome = await withTransaction(this.pool, async (client) => {
      const found = await client.query<{
        user_id: number;
        family_id: string;
        consumed_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT user_id, family_id, consumed_at, revoked_at, expires_at
           FROM auth.refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [sha256(rawToken)],
      );
      const token = found.rows[0];
      if (!token) throw new Unauthenticated('Refresh token is invalid');

      if (token.consumed_at || token.revoked_at) {
        await client.query(
          `UPDATE auth.refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
            WHERE family_id = $1`,
          [token.family_id],
        );
        return { kind: 'replay' as const };
      }
      if (token.expires_at.getTime() <= Date.now()) {
        throw new Unauthenticated('Refresh token has expired');
      }

      const consumed = await client.query(
        `UPDATE auth.refresh_tokens SET consumed_at = now()
          WHERE token_hash = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [sha256(rawToken)],
      );
      if (consumed.rowCount !== 1) {
        await client.query(
          `UPDATE auth.refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1`,
          [token.family_id],
        );
        return { kind: 'replay' as const };
      }

      const userResult = await client.query<TokenUser>(
        `SELECT id, token_version, role FROM auth.users WHERE id = $1`,
        [token.user_id],
      );
      if (!userResult.rows[0]) throw new Unauthenticated('Refresh token user no longer exists');
      return {
        kind: 'success' as const,
        response: await this.issueTokenPair(client, userResult.rows[0], token.family_id),
      };
    });

    if (outcome.kind === 'replay') throw new TokenReuseDetected();
    return outcome.response;
  }

  async logout(rawToken: string) {
    return withTransaction(this.pool, async (client) => {
      const found = await client.query<{ family_id: string }>(
        `SELECT family_id FROM auth.refresh_tokens WHERE token_hash = $1`,
        [sha256(rawToken)],
      );
      if (!found.rows[0]) throw new Unauthenticated('Refresh token is invalid');
      const revoked = await client.query(
        `UPDATE auth.refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [found.rows[0].family_id],
      );
      return { logged_out: true, tokens_revoked: revoked.rowCount ?? 0 };
    });
  }

  async logoutAll(userId: number) {
    return withTransaction(this.pool, async (client) => {
      await client.query(`UPDATE auth.users SET token_version = token_version + 1 WHERE id = $1`, [userId]);
      const revoked = await client.query(
        `UPDATE auth.refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      return { sessions_revoked: revoked.rowCount ?? 0 };
    });
  }

  async me(userId: number) {
    const result = await this.pool.query(
      `SELECT id, phone, name, status, (totp_secret IS NOT NULL) AS totp_enrolled
         FROM auth.users WHERE id = $1`,
      [userId],
    );
    if (!result.rows[0]) throw new UserNotFound();
    return result.rows[0];
  }

  async changePin(userId: number, currentPin: string, newPin: string) {
    const newHash = await bcrypt.hash(newPin, config.bcryptCost);
    return withTransaction(this.pool, async (client) => {
      const found = await client.query<{ pin_hash: string }>(
        `SELECT pin_hash FROM auth.users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (!found.rows[0]) throw new UserNotFound();
      if (!(await bcrypt.compare(currentPin, found.rows[0].pin_hash))) {
        throw new Unauthenticated('Current PIN is incorrect');
      }

      await client.query(
        `UPDATE auth.users SET pin_hash = $2, token_version = token_version + 1 WHERE id = $1`,
        [userId, newHash],
      );
      const revoked = await client.query<{ family_id: string }>(
        `UPDATE auth.refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1 AND revoked_at IS NULL RETURNING family_id`,
        [userId],
      );
      return { sessions_revoked: new Set(revoked.rows.map((row) => row.family_id)).size };
    });
  }

  async stepUp(userId: number, dto: StepUpDto) {
    if (dto.method === 'TOTP') {
      throw new AppError(501, 'NOT_IMPLEMENTED', 'TOTP step-up is not implemented');
    }
    const result = await this.pool.query<{ pin_hash: string }>(
      `SELECT pin_hash FROM auth.users WHERE id = $1`,
      [userId],
    );
    if (!result.rows[0] || !(await bcrypt.compare(dto.pin ?? '', result.rows[0].pin_hash))) {
      throw new Unauthenticated('PIN is incorrect');
    }
    return {
      step_up_token: signStepUpToken(config.jwtPrivateKey, { sub: userId, method: 'PIN' }),
      expires_in: 120,
    };
  }

  wsToken(userId: number) {
    return {
      token: jwt.sign({ sub: String(userId) }, config.centrifugoTokenSecret),
      channel: `user#${userId}`,
      url: config.centrifugoWsUrl,
    };
  }
}
