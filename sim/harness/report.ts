import * as fs from 'fs';
import * as path from 'path';
import { ScenarioOutcome } from './runner';

export interface GroupResult {
  group: string;
  outcomes: ScenarioOutcome[];
}

/**
 * Terminal board matching SIMULATOR.md §5's format: one line per group with
 * a pass count, one line per scenario inside a group that failed (passing
 * scenarios don't need a line each — the group count says enough), and a
 * failure prints id / assertion / expected-vs-actual / the invariant
 * snapshot before and after, so a conservation break points at the
 * scenario that caused it rather than the one that noticed it.
 */
export function printReport(groups: GroupResult[]): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const failures: ScenarioOutcome[] = [];

  console.log('  PSTU Money Movement — Scenario Simulator          ' + new Date().toISOString());
  console.log('  ' + '-'.repeat(66));

  for (const g of groups) {
    const groupPassed = g.outcomes.filter((o) => o.pass).length;
    const total = g.outcomes.length;
    const label = `${g.group.toUpperCase()}`.padEnd(24);
    console.log(`  ${label}${String(groupPassed).padStart(3)}/${total}  ${groupPassed === total ? 'PASS' : 'FAIL'}`);
    for (const o of g.outcomes) {
      passed += o.pass ? 1 : 0;
      failed += o.pass ? 0 : 1;
      if (!o.pass) failures.push(o);
    }
  }

  console.log('  ' + '-'.repeat(66));
  console.log(`  ${passed} passed  ${failed} failed`);

  if (failures.length > 0) {
    console.log('\n  FAILURES:\n');
    for (const f of failures) {
      console.log(`  ${f.id}  ${f.name}`);
      console.log(`    ${f.error}`);
      if (f.before) {
        console.log(
          `    invariants before: total=${f.before.conservationTotalPaisa} drift=${f.before.driftRows.length} negative=${f.before.negativeRows.length} unbalanced=${f.before.unbalancedTxns.length}`,
        );
      }
      if (f.after) {
        console.log(
          `    invariants after:  total=${f.after.conservationTotalPaisa} drift=${f.after.driftRows.length} negative=${f.after.negativeRows.length} unbalanced=${f.after.unbalancedTxns.length}`,
        );
      }
      console.log();
    }
  } else {
    console.log(`\n  Conservation held across all ${passed} scenarios.`);
  }

  return { passed, failed };
}

export function writeJsonReport(groups: GroupResult[], outPath = path.resolve(__dirname, '..', 'sim-results.json')) {
  fs.writeFileSync(outPath, JSON.stringify(groups, null, 2));
}
