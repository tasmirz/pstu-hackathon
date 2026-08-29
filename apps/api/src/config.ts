import * as fs from 'fs';
import * as path from 'path';

function readEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
readEnvFile();

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(__dirname, '..', p);
}

export const config = {
  port: Number(process.env.PORT || 3000),

  authDatabaseUrl: process.env.AUTH_DATABASE_URL || 'postgres://auth_svc:changeme_auth@localhost:6432/pstu',
  ledgerDatabaseUrl: process.env.LEDGER_DATABASE_URL || 'postgres://txn_svc:changeme_txn@localhost:6432/pstu',
  readDatabaseUrl: process.env.READ_DATABASE_URL || 'postgres://read_svc:changeme_read@localhost:6432/pstu',

  jwtPrivateKey: fs.readFileSync(resolvePath(process.env.JWT_PRIVATE_KEY_PATH || '../../infra/keys/private.pem'), 'utf8'),
  jwtPublicKey: fs.readFileSync(resolvePath(process.env.JWT_PUBLIC_KEY_PATH || '../../infra/keys/public.pem'), 'utf8'),

  bcryptCost: Number(process.env.BCRYPT_COST || 10),
  failedPinLockoutThreshold: Number(process.env.FAILED_PIN_LOCKOUT_THRESHOLD || 5),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES || 15),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  signupBonusPaisa: Number(process.env.SIGNUP_BONUS_PAISA || 10_000_000),

  dailyLimitDefaultPaisa: Number(process.env.DAILY_LIMIT_DEFAULT_PAISA || 5_000_000),
  stepUpAmountThresholdPaisa: Number(process.env.STEP_UP_AMOUNT_THRESHOLD_PAISA || 2_000_000),
  undoWindowSeconds: Number(process.env.UNDO_WINDOW_SECONDS || 60),
  sweeperIntervalMs: Number(process.env.SWEEPER_INTERVAL_MS || 5000),
  undoThresholdPaisa: Number(process.env.UNDO_THRESHOLD_PAISA || 500_000),

  disputeWindowDays: Number(process.env.DISPUTE_WINDOW_DAYS || 7),

  // Below this score, sending money requires step-up regardless of amount
  // (API.md "Reputation" — reason LOW_REPUTATION_RECIPIENT). See
  // ledger.v_user_reputation (infra/sql/005_reputation_claude.sql) for the
  // score formula — 0-100, this is the single threshold consumers apply.
  reputationStepUpThreshold: Number(process.env.REPUTATION_STEP_UP_THRESHOLD || 30),

  centrifugoTokenSecret: process.env.CENTRIFUGO_TOKEN_SECRET || 'changeme_centrifugo_secret',
  centrifugoWsUrl: process.env.CENTRIFUGO_WS_URL || 'ws://localhost:8000/connection/websocket',
};
