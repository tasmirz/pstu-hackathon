import { Controller, Get, Inject, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { UserNotFound } from '@pstu/shared';
import { Pool } from 'pg';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { READ_POOL } from '../../db/db.module';
import { reputationTier } from '../query/reputation';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminReputationController {
  constructor(@Inject(READ_POOL) private readonly readPool: Pool) {}

  @Get(':id/reputation')
  async getReputation(@Param('id', ParseIntPipe) userId: number) {
    const result = await this.readPool.query(
      `SELECT user_id, status, created_at, account_age_days,
              completed_txn_count, disputes_reversed_involving,
              disputes_raised, reputation_score
         FROM ledger.v_user_reputation
        WHERE user_id = $1`,
      [userId],
    );
    const reputation = result.rows[0];
    if (!reputation) throw new UserNotFound();
    return {
      ...reputation,
      tier: reputationTier(reputation.reputation_score),
    };
  }
}
