// Applies SCHEMA.sql then infra/sql/*.sql amendments, in order, as the owner
// role, DIRECTLY against :5432 — never through PgBouncer (migrations take
// session-level advisory locks that pool_mode=transaction breaks).
//
// Each infra/sql/*.sql file now runs at most once ever (tracked in
// public.schema_migrations by filename — see below). If you're still
// iterating on a migration file that already ran once, either bump its
// number to a new filename or delete its row from schema_migrations before
// re-running this script — editing the same file in place and expecting a
// second `db:apply` to pick it up silently won't work anymore.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');

async function run() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'pstu',
  });
  await client.connect();

  const { rows } = await client.query(
    `SELECT to_regclass('auth.users') IS NOT NULL AS exists`,
  );
  const baseApplied = rows[0].exists;

  // Track which infra/sql/*.sql files have already run, by filename. This
  // used to unconditionally replay every amendment on every invocation,
  // which was fine while each file was independently idempotent — but two
  // migrations can legitimately both touch the same object (e.g. two files
  // each widening ledger.transactions' kind CHECK constraint with their own
  // DROP+ADD). Replayed in filename order against a database that already
  // has data from the *later* file, the *earlier* file's narrower ADD
  // CONSTRAINT fails outright. Running each amendment exactly once removes
  // the whole class of bug: a file's SQL only ever runs against the schema
  // state its author actually tested it against.
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows: appliedRows } = await client.query(
    `SELECT filename FROM public.schema_migrations`,
  );
  const alreadyApplied = new Set(appliedRows.map((r) => r.filename));

  const files = [
    ...(baseApplied ? [] : [path.join(ROOT, 'SCHEMA.sql')]),
    ...fs
      .readdirSync(path.join(ROOT, 'infra', 'sql'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => path.join(ROOT, 'infra', 'sql', f)),
  ];

  if (baseApplied) {
    console.log('SCHEMA.sql already applied (auth.users exists) — re-running amendments only.');
  }

  for (const file of files) {
    const relName = path.relative(ROOT, file);
    // SCHEMA.sql itself is never tracked in schema_migrations (it's gated by
    // the auth.users check above, and only ever runs once regardless).
    const trackingKey = path.basename(file);
    if (relName !== 'SCHEMA.sql' && alreadyApplied.has(trackingKey)) {
      console.log(`\n=== skipping ${relName} (already applied) ===`);
      continue;
    }

    console.log(`\n=== applying ${relName} ===`);
    const sql = fs.readFileSync(file, 'utf8');
    try {
      await client.query(sql);
      if (relName !== 'SCHEMA.sql') {
        await client.query(
          `INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
          [trackingKey],
        );
      }
      console.log('OK');
    } catch (err) {
      console.error('FAILED:', err.message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('\nSchema applied.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
