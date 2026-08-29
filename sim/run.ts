import { createPool } from '@pstu/shared';
import { simConfig } from './config';
import { runScenario } from './harness/runner';
import { printReport, writeJsonReport, GroupResult } from './harness/report';
import { Scenario } from './harness/types';
import { ledgerScenarios } from './scenarios/ledger';
import { happyScenarios } from './scenarios/happy';
import { idempotencyScenarios } from './scenarios/idempotency';

/**
 * CLI: `npm run sim -w sim -- [--only ID] [--tag TAG] [--json]`
 *
 * LEDGER is pure SQL, no server needed. HAPPY and IDEMPOTENCY drive the
 * real API via `harness/client.ts` and need `apps/api` running (see
 * `simConfig.apiBaseUrl`, default http://localhost:3000). VAL/CON/... are
 * still unclaimed — add them the same way once written.
 */

interface Args {
  only?: string;
  tag?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--tag') args.tag = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

const GROUPS: Record<string, Scenario[]> = {
  ledger: ledgerScenarios,
  happy: happyScenarios,
  idempotency: idempotencyScenarios,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const adminPool = createPool({ connectionString: simConfig.adminUrl });
  const txnSvcPool = createPool({ connectionString: simConfig.txnSvcUrl });

  const results: GroupResult[] = [];

  for (const [groupName, scenarios] of Object.entries(GROUPS)) {
    const filtered = scenarios.filter((s) => {
      if (args.only && s.id !== args.only) return false;
      if (args.tag && !s.tags.includes(args.tag)) return false;
      return true;
    });
    if (filtered.length === 0) continue;

    const outcomes = [];
    for (const scenario of filtered) {
      outcomes.push(await runScenario(adminPool, txnSvcPool, scenario));
    }
    results.push({ group: groupName, outcomes });
  }

  const { failed } = printReport(results);
  if (args.json) writeJsonReport(results);

  await adminPool.end();
  await txnSvcPool.end();

  process.exit(failed);
}

main().catch((err) => {
  console.error('Simulator crashed:', err);
  process.exit(1);
});
