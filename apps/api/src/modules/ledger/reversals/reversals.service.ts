import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { canonical, NotAParty, sha256, TxnNotFound, withTransaction } from '@pstu/shared';
import { LEDGER_POOL } from '../../../db/db.module';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../../../common/idempotency.util';
import { requireStepUp } from '../../../common/step-up.util';
import { ReversalCoreService } from '../core/reversal-core.service';

@Injectable()
export class ReversalsService {
  constructor(
    @Inject(LEDGER_POOL) private readonly pool: Pool,
    private readonly reversalCore: ReversalCoreService,
  ) {}

  async reverse(actorId: number, txnId: number, idemKey: string, stepUpToken?: string) {
    requireStepUp({ userId: actorId, token: stepUpToken, reason: 'REVERSAL', always: true });

    const reqHash = sha256(canonical({ actorId, txnId }));

    return withTransaction(this.pool, async (t) => {
      const claim = await claimIdempotencyKey(t, actorId, idemKey, reqHash);
      if (!claim.isNew) return claim.response;

      const check = await t.query(`SELECT sender_id, receiver_id FROM ledger.transactions WHERE id = $1`, [txnId]);
      if (!check.rows[0]) throw new TxnNotFound();
      // Only the original sender may self-serve a reversal — the receiver-side
      // equivalent is POST /transactions/:id/refund; anyone else goes through
      // a dispute instead.
      if (check.rows[0].sender_id !== actorId) throw new NotAParty();

      const reversal = await this.reversalCore.applyReversal(t, txnId);
      const response = {
        reversal: reversal.transaction,
        original: { id: txnId, state: 'REVERSED' },
      };

      await storeIdempotencyResponse(t, actorId, idemKey, response);
      return response;
    });
  }
}
