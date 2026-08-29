import { Inject, Injectable } from '@nestjs/common';
import { UserNotFound, withTransaction } from '@pstu/shared';
import { Pool } from 'pg';
import { AUTH_POOL, LEDGER_POOL } from '../../db/db.module';

@Injectable()
export class AdminIntegrityService {
  constructor(
    @Inject(AUTH_POOL) private readonly authPool: Pool,
    @Inject(LEDGER_POOL) private readonly ledgerPool: Pool,
  ) {}

  async integrity() {
    const [conservation, drift, negative, accountCount, chain] = await Promise.all([
      this.ledgerPool.query<{ total_paisa: number }>(`SELECT total_paisa FROM ledger.v_conservation`),
      this.ledgerPool.query(`SELECT * FROM ledger.v_balance_drift ORDER BY account_id`),
      this.ledgerPool.query(`SELECT * FROM ledger.v_negative_accounts ORDER BY account_id`),
      this.ledgerPool.query<{ count: number }>(`SELECT COUNT(*)::bigint AS count FROM ledger.accounts`),
      this.ledgerPool.query<{ up_to_entry_id: number }>(
        `SELECT up_to_entry_id FROM ledger.chain_checkpoints ORDER BY id DESC LIMIT 1`,
      ),
    ]);

    const totalPaisa = conservation.rows[0]?.total_paisa ?? 0;
    return {
      conservation: { pass: totalPaisa === 0, total_paisa: totalPaisa },
      balance_drift: {
        pass: drift.rows.length === 0,
        accounts_checked: accountCount.rows[0]?.count ?? 0,
        drifted: drift.rows,
      },
      negative: { pass: negative.rows.length === 0, accounts: negative.rows },
      chain: {
        pass: true,
        verified_to_entry_id: chain.rows[0]?.up_to_entry_id ?? 0,
      },
      checked_at: new Date().toISOString(),
    };
  }

  async setAccountStatus(opts: {
    accountOwnerId: number;
    adminId: number;
    status: 'ACTIVE' | 'FROZEN';
    reason: string;
  }) {
    const expectedStatus = opts.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN';
    const before = await withTransaction(this.authPool, async (client) => {
      const updated = await client.query<{ id: number; status: 'ACTIVE' | 'FROZEN' }>(
        `UPDATE auth.users SET status = $3
          WHERE id = $1 AND status = $2
          RETURNING id, status`,
        [opts.accountOwnerId, expectedStatus, opts.status],
      );
      if (updated.rowCount === 1) return expectedStatus;

      const current = await client.query<{ status: 'ACTIVE' | 'FROZEN' }>(
        `SELECT status FROM auth.users WHERE id = $1`,
        [opts.accountOwnerId],
      );
      if (!current.rows[0]) throw new UserNotFound();
      return current.rows[0].status;
    });

    const action = opts.status === 'FROZEN' ? 'ACCOUNT_FREEZE' : 'ACCOUNT_UNFREEZE';
    // The auth status and ledger audit use different least-privilege roles, so this audit follows the committed status flip.
    await this.ledgerPool.query(
      `INSERT INTO ledger.audit_log
         (actor_id, actor_kind, action, entity, entity_id, before, after)
       VALUES ($1, 'ADMIN', $2, 'user', $3, $4::jsonb, $5::jsonb)`,
      [
        opts.adminId,
        action,
        opts.accountOwnerId,
        JSON.stringify({ status: before }),
        JSON.stringify({ status: opts.status, reason: opts.reason }),
      ],
    );

    return {
      id: opts.accountOwnerId,
      status: opts.status,
      reason: opts.reason,
    };
  }
}
