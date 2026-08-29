import { Global, Module } from '@nestjs/common';
import { createPool } from '@pstu/shared';
import { config } from '../config';

/**
 * Three pools, three DB roles — auth_svc / txn_svc / read_svc, exactly the
 * roles SCHEMA.sql defines. Even collapsed into one process (see
 * BUILD_LOG_CLAUDE.md "Pivot"), a module can only do what its own pool's
 * role is granted: LedgerModule's pool has no UPDATE/DELETE on
 * ledger.entries, QueryModule's pool has no write grant on ledger at all.
 * That boundary is what makes the eventual service split a deploy change,
 * not a rewrite.
 */
export const AUTH_POOL = 'AUTH_POOL';
export const LEDGER_POOL = 'LEDGER_POOL';
export const READ_POOL = 'READ_POOL';

@Global()
@Module({
  providers: [
    { provide: AUTH_POOL, useFactory: () => createPool({ connectionString: config.authDatabaseUrl }) },
    { provide: LEDGER_POOL, useFactory: () => createPool({ connectionString: config.ledgerDatabaseUrl }) },
    { provide: READ_POOL, useFactory: () => createPool({ connectionString: config.readDatabaseUrl }) },
  ],
  exports: [AUTH_POOL, LEDGER_POOL, READ_POOL],
})
export class DbModule {}
