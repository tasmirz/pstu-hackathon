import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { simConfig } from '../config';
import { ApiClient, SimUser } from './client';

export class ScenarioAssertionError extends Error {}

export interface ScenarioContext {
  adminPool: Pool;
  txnSvcPool: Pool;
  apiBaseUrl: string;
  client: ApiClient;
  uuid(): string;
  expect(condition: boolean, message: string): void;
  expectEq<T>(actual: T, expected: T, message?: string): void;
  expectAllIdentical<T>(values: T[]): void;
  /** registers `n` brand-new users through POST /auth/register (unique phones) */
  freshUsers(n: number, namePrefix?: string): Promise<SimUser[]>;
  /** same as freshUsers(n) but returns exactly one */
  freshUser(name?: string): Promise<SimUser>;
  /** promotes a user to ADMIN via the DB (JwtAuthGuard reads role fresh per request) */
  makeAdmin(user: SimUser): Promise<void>;
  /** current USER-account balance via GET /accounts/me/balance */
  balance(user: SimUser): Promise<number>;
  /** sends money, auto-performing the PIN step-up if the API asks for it */
  transfer(from: SimUser, to: SimUser, amountPaisa: number, opts?: { key?: string; note?: string }): Promise<any>;
  countTxns(filter: { ref?: string; state?: string }): Promise<number>;
}

export function makeContext(adminPool: Pool, txnSvcPool: Pool): ScenarioContext {
  const client = new ApiClient(simConfig.apiBaseUrl);
  const ctx: ScenarioContext = {
    adminPool,
    txnSvcPool,
    apiBaseUrl: simConfig.apiBaseUrl,
    client,
    uuid: () => randomUUID(),
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
    expectAllIdentical(values) {
      if (values.length === 0) return;
      const first = JSON.stringify(values[0]);
      const ok = values.every((v) => JSON.stringify(v) === first);
      if (!ok) throw new ScenarioAssertionError('expected all values identical, got differing values');
    },

    async freshUsers(n, namePrefix = 'Sim') {
      const users: SimUser[] = [];
      for (let i = 0; i < n; i += 1) {
        users.push(await ctx.freshUser(`${namePrefix} ${i + 1}`));
      }
      return users;
    },

    async freshUser(name = 'Sim User') {
      const phone = `+880${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 9000) + 1000)}${name.charCodeAt(name.length - 1) % 10}`;
      const res = await client.register(phone, name, '1234');
      if (res.status !== 201) {
        throw new ScenarioAssertionError(
          `register failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
        );
      }
      return { ...res.body, pin: '1234' };
    },

    async makeAdmin(user) {
      await adminPool.query(`UPDATE auth.users SET role = 'ADMIN' WHERE id = $1`, [user.user.id]);
    },

    async balance(user) {
      const res = await client.balance(user.access_token);
      if (res.status !== 200) {
        throw new ScenarioAssertionError(`balance failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
      }
      return res.body.balance_paisa;
    },

    async transfer(from, to, amountPaisa, opts = {}) {
      const key = opts.key ?? ctx.uuid();
      let res = await client.transfer(from.access_token, to.user.phone, amountPaisa, {
        idemKey: key,
        note: opts.note,
      });
      if (res.status === 403 && res.body?.error === 'STEP_UP_REQUIRED') {
        const su = await client.stepUp(from.access_token, 'PIN', from.pin);
        if (su.status !== 200) {
          throw new ScenarioAssertionError(`step-up failed: ${su.status} ${JSON.stringify(su.body).slice(0, 200)}`);
        }
        res = await client.transfer(from.access_token, to.user.phone, amountPaisa, {
          idemKey: key,
          note: opts.note,
          stepUpToken: su.body.step_up_token,
        });
      }
      return res;
    },

    async countTxns(filter) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.ref) {
        params.push(filter.ref);
        where.push(`ref = $${params.length}`);
      }
      if (filter.state) {
        params.push(filter.state);
        where.push(`state = $${params.length}`);
      }
      const sql = `SELECT COUNT(*)::int AS c FROM ledger.transactions${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
      const { rows } = await adminPool.query(sql, params);
      return rows[0].c;
    },
  };

  return ctx;
}