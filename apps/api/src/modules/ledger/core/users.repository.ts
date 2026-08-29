import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { UserNotFound } from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';

export interface LedgerUser {
  id: number;
  phone: string;
  name: string;
  status: 'ACTIVE' | 'FROZEN';
  role: 'USER' | 'ADMIN';
}

/**
 * Reads `auth.users_public` — the narrow view granted to txn_svc (see
 * infra/sql/001_amendments_claude.sql). Never touches pin_hash/totp_secret.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(LEDGER_POOL) private readonly pool: Pool) {}

  async findByPhone(phone: string, client?: Pool | PoolClient): Promise<LedgerUser> {
    const { rows } = await (client ?? this.pool).query(
      `SELECT id, phone, name, status, role FROM auth.users_public WHERE phone = $1`,
      [phone],
    );
    if (!rows[0]) throw new UserNotFound();
    return rows[0];
  }

  async findById(id: number, client?: Pool | PoolClient): Promise<LedgerUser> {
    const { rows } = await (client ?? this.pool).query(
      `SELECT id, phone, name, status, role FROM auth.users_public WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new UserNotFound();
    return rows[0];
  }
}
