import { createPool } from '@pstu/shared';
import { simConfig } from './config';
import { runScenario, ScenarioOutcome } from './harness/runner';
import { printReport, writeJsonReport, GroupResult } from './harness/report';
import { Scenario } from './harness/types';
import { resetForCleanRun } from './harness/seed';
import { ApiClient } from './harness/client';
import { ledgerScenarios } from './scenarios/ledger';
import { happyScenarios } from './scenarios/happy';
import { idempotencyScenarios } from './scenarios/idempotency';
import { validationScenarios } from './scenarios/validation';
import { concurrencyScenarios } from './scenarios/concurrency';
import { holdScenarios } from './scenarios/hold';
import { reversalScenarios } from './scenarios/reversal';
import { requestsScenarios } from './scenarios/requests';
import { disputeScenarios } from './scenarios/dispute';
import { authScenarios } from './scenarios/auth';
import { limitsScenarios } from './scenarios/limits';
import { billsScenarios } from './scenarios/bills';
import { chaosScenarios } from './scenarios/chaos';
import { notificationScenarios } from './scenarios/notifications';

/**
 * CLI: `npm run sim -w sim -- [--only ID] [--tag TAG] [--json] [--reset] [--bail]`
 *
 * SIMULATOR.md §5 — the board. The ledger group is pure SQL and runs even if
 * the API is down; every other group needs the live server (checked up front,
 * once, by `--reset` or an HTTP probe), and every scenario is wrapped by the
 * runner's universal invariant checks (conservation / drift / negative /
 * balanced) whether or not its own assertions pass.
 */

interface Args {
  only?: string;
  tag?: string;
  json: boolean;
  reset: boolean;
  bail: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, reset: false, bail: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--tag') args.tag = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--reset') args.reset = true;
    else if (argv[i] === '--bail') args.bail = true;
  }
  return args;
}

const GROUPS: Record<string, Scenario[]> = {
  ledger: ledgerScenarios,
  happy: happyScenarios,
  idempotency: idempotencyScenarios,
  validation: validationScenarios,
  concurrency: concurrencyScenarios,
  hold: holdScenarios,
  reversal: reversalScenarios,
  requests: requestsScenarios,
  dispute: disputeScenarios,
  auth: authScenarios,
  limits: limitsScenarios,
  bills: billsScenarios,
  notifications: notificationScenarios,
  chaos: chaosScenarios,
};

async function apiIsUp(): Promise<boolean> {
  const client = new ApiClient(simConfig.apiBaseUrl);
  try {
    // Unauthenticated /auth/me returns 401, not a network error — that means
    // the server is listening. Any HTTP status proves the API is reachable.
    const res = await client.me('');
    return res.status > 0;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const adminPool = createPool({ connectionString: simConfig.adminUrl });
  const txnSvcPool = createPool({ connectionString: simConfig.txnSvcUrl });

  if (args.reset) {
    console.log('  --reset: truncating ledger + auth for a clean run');
    await resetForCleanRun(adminPool);
  }

  const needsApi = Object.entries(GROUPS).some(
    ([name, scenarios]) =>
      name !== 'ledger' &&
      scenarios.some((s) => {
        if (args.only && s.id !== args.only) return false;
        if (args.tag && !s.tags.includes(args.tag)) return false;
        return true;
      }),
  );
  if (needsApi && !(await apiIsUp())) {
    console.error(
      `  API is not reachable at ${simConfig.apiBaseUrl} — start apps/api (npm run start -w apps/api) first, or use --only ledger`,
    );
    await adminPool.end();
    await txnSvcPool.end();
    process.exit(2);
  }

  const results: GroupResult[] = [];
  let failedCount = 0;

  for (const [groupName, scenarios] of Object.entries(GROUPS)) {
    const filtered = scenarios.filter((s) => {
      if (args.only && s.id !== args.only) return false;
      if (args.tag && !s.tags.includes(args.tag)) return false;
      return true;
    });
    if (filtered.length === 0) continue;

    const outcomes: ScenarioOutcome[] = [];
    for (const scenario of filtered) {
      outcomes.push(await runScenario(adminPool, txnSvcPool, scenario));
      if (args.bail && outcomes[outcomes.length - 1].pass === false) break;
    }
    failedCount += outcomes.filter((o) => !o.pass).length;
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