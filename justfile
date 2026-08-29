# PSTU Money Movement — task runner. Infra is always Docker; the app runs
# locally against it (see README.md). Install `just`: https://just.systems

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# List available recipes
default:
    @just --list

# --- Setup -----------------------------------------------------------------

# Install all workspace dependencies
install:
    npm install

# Bring up Postgres/PgBouncer/Redis/Redpanda/Centrifugo
infra-up:
    npm run infra:up

# Tear down infra containers
infra-down:
    npm run infra:down

# Tail infra container logs
infra-logs:
    npm run infra:logs

# Apply SCHEMA.sql + every infra/sql/*.sql amendment, in order (idempotent)
db-apply:
    npm run db:apply

# Promote a user to ADMIN by id — usage: just promote-admin 3
promote-admin id:
    node scripts/promote-admin.js {{id}}

# Infra up + schema applied — the one command for a cold start
bootstrap: infra-up db-apply

# --- App ---------------------------------------------------------------

# Run apps/api with hot-reload (needs infra up + schema applied)
dev:
    npm run dev

# Build every workspace
build:
    npm run build

# --- Simulator ---------------------------------------------------------

# Run the full scenario board (needs the app up)
sim:
    npm run sim

# Run one scenario group — usage: just sim-tag disputes
sim-tag tag:
    npm run sim -- --tag {{tag}}

# Run one scenario by id — usage: just sim-only DIS-01
sim-only id:
    npm run sim -- --only {{id}}

# Truncate ledger/auth data first, then run the full board
sim-reset:
    npm run sim -- --reset

# --- Ad-hoc verification scripts (scripts/) -----------------------------

test-antigravity:
    node scripts/test-antigravity.js

test-antigravity-round2:
    node scripts/test-antigravity-round2.js

test-antigravity-round3:
    node scripts/test-antigravity-round3.js
