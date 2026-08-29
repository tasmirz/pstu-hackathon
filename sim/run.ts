import { createPool } from '@pstu/shared';
import { simConfig } from './config';
import { runScenario } from './harness/runner';
import { printReport, writeJsonReport, GroupResult } from './harness/report';
import { Scenario } from './harness/types';
import { ledgerScenarios } from './scenarios/ledger';

/**
 * CLI: `npm run sim -w sim -- [--only ID] [--tag TAG] [--json]`
 *
 * Only the LEDGER group is wired in so far — it's pure SQL and runs today
 * regardless of whether the app has finished booting. Every other group
 * (HAP/IDEM/VAL/CON/...) needs `harness/client.ts` (a typed HTTP client
 * against API.md) plus a live server, and gets added once Codex's
 * bootstrap is confirmed up — see CLAUDE_BUILD_LOG.md.
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
