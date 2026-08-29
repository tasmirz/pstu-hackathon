import { Pool } from 'pg';
import { simConfig } from '../config';

export class ScenarioAssertionError extends Error {}

export interface ScenarioContext {
  adminPool: Pool;
  txnSvcPool: Pool;
  apiBaseUrl: string;
  uuid(): string;
  expect(condition: boolean, message: string): void;
  expectEq<T>(actual: T, expected: T, message?: string): void;
}

export function makeContext(adminPool: Pool, txnSvcPool: Pool): ScenarioContext {
  return {
    adminPool,
    txnSvcPool,
    apiBaseUrl: simConfig.apiBaseUrl,
    uuid: () => cryptoRandomUUID(),
    expect(condition, message) {
      if (!condition) throw new ScenarioAssertionError(message);
    },
    expectEq(actual, expected, message) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      if (!ok) {
        throw new ScenarioAssertionError(
          `${message ? message + ' — ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
      }
    },
  };
}

function cryptoRandomUUID(): string {
  // Node 20 has crypto.randomUUID globally; kept as a tiny indirection so
  // scenario files never need to import `crypto` themselves.
  return require('crypto').randomUUID();
}

export interface Scenario {
  id: string;
  name: string;
  tags: string[];
  /** LEDGER-group scenarios are pure SQL and need no live API — everything
   * else waits for the server to be up (checked once, up front, by run.ts). */
  requiresApi?: boolean;
  run(ctx: ScenarioContext): Promise<void>;
}
