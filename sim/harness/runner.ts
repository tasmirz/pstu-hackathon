import { Pool } from 'pg';
import { checkStructuralInvariants, InvariantSnapshot } from './invariants';
import { makeContext, Scenario, ScenarioAssertionError } from './types';

export interface ScenarioOutcome {
  id: string;
  name: string;
  tags: string[];
  pass: boolean;
  ms: number;
  error?: string;
  before?: InvariantSnapshot;
  after?: InvariantSnapshot;
}

/**
 * SIMULATOR.md §1: `snapshot invariants -> run scenario -> scenario
 * assertions -> UNIVERSAL assertions <- always, free`. A scenario file
 * never re-checks conservation/drift/negative/balanced itself — this
 * wrapper does it after every single one, so a bug shows up on whichever
 * scenario runs next, not only the one written to look for it.
 */
export async function runScenario(adminPool: Pool, txnSvcPool: Pool, scenario: Scenario): Promise<ScenarioOutcome> {
  const start = Date.now();
  const before = await checkStructuralInvariants(adminPool);

  try {
    await scenario.run(makeContext(adminPool, txnSvcPool));
  } catch (err) {
    const after = await checkStructuralInvariants(adminPool).catch(() => undefined);
    return {
      id: scenario.id,
      name: scenario.name,
      tags: scenario.tags,
      pass: false,
      ms: Date.now() - start,
      error: err instanceof ScenarioAssertionError ? err.message : `${(err as Error).message}`,
      before: before.snapshot,
      after: after?.snapshot,
    };
  }

  const after = await checkStructuralInvariants(adminPool);
  if (!after.ok) {
    return {
      id: scenario.id,
      name: scenario.name,
      tags: scenario.tags,
      pass: false,
      ms: Date.now() - start,
      error: `scenario's own assertions passed, but universal invariants broke: ${after.failures.join('; ')}`,
      before: before.snapshot,
      after: after.snapshot,
    };
  }

  return {
    id: scenario.id,
    name: scenario.name,
    tags: scenario.tags,
    pass: true,
    ms: Date.now() - start,
    before: before.snapshot,
    after: after.snapshot,
  };
}
