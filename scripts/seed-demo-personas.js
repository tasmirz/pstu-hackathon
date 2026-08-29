// One-off / re-runnable: seed the demo personas used by the frontend's
// UserSwitcher into the REAL backend (matching frontend/src/lib/mock-engine.ts
// phones + pins). Run with the API up: node scripts/seed-demo-personas.js
//
// The frontend personas are: Rahim #42, Karim #43, Alam #44, Nadia #45,
// System Admin #1 (pin 9999). Ids here won't match the mock ids — the frontend
// resolves users by phone/token in real mode, so that's fine.
const { Client } = require('pg');

const API = 'http://localhost:3000';

const PERSONAS = [
  { phone: '+8801712345678', name: 'Rahim Ahmed', pin: '1234', admin: false },
  { phone: '+8801798765432', name: 'Karim Uddin', pin: '1234', admin: false },
  { phone: '+8801733445566', name: 'Alam Hossain', pin: '1234', admin: false },
  { phone: '+8801755667788', name: 'Nadia Sultana', pin: '1234', admin: false },
  { phone: '+8801700000000', name: 'System Admin', pin: '9999', admin: true },
];

async function api(path, opts) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function main() {
  const pg = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'pstu' });
  await pg.connect();

  for (const p of PERSONAS) {
    let reg = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone: p.phone, name: p.name, pin: p.pin }),
    });

    if (reg.status === 400 && reg.body?.error === 'VALIDATION_ERROR') {
      // Already registered — make sure the PIN is still the expected one by
      // attempting a login; if login fails we leave the account as-is (a demo
      // op can re-register with a fresh phone via the login screen).
      const lg = await api('/auth/login', { method: 'POST', body: JSON.stringify({ phone: p.phone, pin: p.pin }) });
      console.log(`  ${p.name.padEnd(16)} exists (login ${lg.status})`);
    } else if (reg.status === 201) {
      console.log(`  ${p.name.padEnd(16)} registered (user #${reg.body.user.id})`);
    } else {
      console.error(`  ${p.name} FAILED: ${reg.status} ${JSON.stringify(reg.body).slice(0, 120)}`);
    }

    if (p.admin) {
      await pg.query(`UPDATE auth.users SET role = 'ADMIN' WHERE phone = $1`, [p.phone]);
      console.log(`  ${p.name.padEnd(16)} promoted to ADMIN`);
    }
  }

  await pg.end();
  console.log('Demo personas ready. Frontend default mode should be REAL (toggle off mock).');
}

main().catch((e) => { console.error('seed failed:', e); process.exit(1); });