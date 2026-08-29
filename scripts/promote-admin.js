// One-off: node scripts/promote-admin.js +8801700000001
const { Client } = require('pg');

async function run() {
  const phone = process.argv[2];
  if (!phone) {
    console.error('usage: node scripts/promote-admin.js <phone>');
    process.exit(1);
  }
  const c = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'pstu' });
  await c.connect();
  const { rows } = await c.query(`UPDATE auth.users SET role = 'ADMIN' WHERE phone = $1 RETURNING id, phone, role`, [
    phone,
  ]);
  console.log(rows[0] ?? 'not found');
  await c.end();
}
run();
