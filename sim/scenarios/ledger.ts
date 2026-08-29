import { checkAppendOnly, checkStructuralInvariants, checkUnbalancedLegRejected } from '../harness/invariants';
import { Scenario } from '../harness/types';

/**
 * SIMULATOR.md's LEDGER group — Tier 1, runs standalone AND (via the
 * runner's automatic wrapper) after every other scenario. These seven are
 * pure SQL; they need no API and no seeded users, which is why they're the
 * first thing built (§6: "10:30–11:10 — invariants.ts, seed.ts, report.ts,
 * runner — nothing blocks this").
 */

export const LED_01: Scenario = {
  id: 'LED-01',
  name: 'Conservation: SUM(entries) = 0',
  tags: ['ledger', 'tier1'],
  async run(ctx) {
    const r = await checkStructuralInvariants(ctx.adminPool);
    ctx.expectEq(r.snapshot.conservationTotalPaisa, 0, 'SUM(ledger.entries.amount)');
  },
};

export const LED_02: Scenario = {
  id: 'LED-02',
  name: 'No cached balance drifts from its ledger-derived balance',
  tags: ['ledger', 'tier1'],
  async run(ctx) {
    const r = await checkStructuralInvariants(ctx.adminPool);
    ctx.expect(r.snapshot.driftRows.length === 0, `${r.snapshot.driftRows.length} account(s) drifted`);
  },
};

export const LED_03: Scenario = {
  id: 'LED-03',
  name: 'No non-mint account is negative',
  tags: ['ledger', 'tier1'],
  async run(ctx) {
    const r = await checkStructuralInvariants(ctx.adminPool);
    ctx.expect(r.snapshot.negativeRows.length === 0, `${r.snapshot.negativeRows.length} account(s) negative`);
  },
};

export const LED_04: Scenario = {
  id: 'LED-04',
  name: 'Every transaction has at least 2 legs summing to zero',
  tags: ['ledger', 'tier1'],
  async run(ctx) {
    const r = await checkStructuralInvariants(ctx.adminPool);
    ctx.expect(r.snapshot.unbalancedTxns.length === 0, `${r.snapshot.unbalancedTxns.length} unbalanced transaction(s)`);
  },
};

export const LED_05: Scenario = {
  id: 'LED-05',
  name: 'UPDATE ledger.entries as txn_svc is denied',
  tags: ['ledger', 'tier1'],
  async run(ctx) {
    const r = await checkAppendOnly(ctx.txnSvcPool);
    ctx.expect(r.updateDenied, `UPDATE was not denied: ${r.detail}`);
  },
};

export const LED_06: Scenario = {
  id: 'LED-06',
  name: 'DELETE FROM ledger.entries as txn_svc is denied',
  tags: ['ledger', 'tier1'],
  async run(ctx) {
    const r = await checkAppendOnly(ctx.txnSvcPool);
    ctx.expect(r.deleteDenied, `DELETE was not denied: ${r.detail}`);
  },
};

export const LED_07: Scenario = {
  id: 'LED-07',
  name: 'Hand-inserted single unbalanced leg is rejected at COMMIT',
  tags: ['ledger', 'tier1'],
  async run(ctx) {
    const r = await checkUnbalancedLegRejected(ctx.adminPool);
    ctx.expect(r.rejected, `expected COMMIT to fail with the balance trigger's error, got: ${r.detail}`);
  },
};

export const ledgerScenarios: Scenario[] = [LED_01, LED_02, LED_03, LED_04, LED_05, LED_06, LED_07];
