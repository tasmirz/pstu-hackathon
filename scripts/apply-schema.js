// Applies SCHEMA.sql then infra/sql/*.sql amendments, in order, as the owner
// role, DIRECTLY against :5432 — never through PgBouncer (migrations take
// session-level advisory locks that pool_mode=transaction breaks).
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
    console.log(`\n=== applying ${path.relative(ROOT, file)} ===`);
    const sql = fs.readFileSync(file, 'utf8');
    try {
      await client.query(sql);
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
