# Kafka + WebSocket Deployment Readiness — where the seams already are

**Reader:** whoever wires the event pipeline (outbox relay → Redpanda/Kafka →
Centrifugo bridge) at deployment time. The point of this file: the code was
written so that split is a **deploy change, not a rewrite** (the "pivot"
decision, `BUILD_LOG_CLAUDE.md`). Every seam below already exists on disk; the
split is mechanical.

---

## 1. The three DB roles are already three pools — the service split is a DI swap

`apps/api/src/db/db.module.ts` creates **three `pg.Pool`s**, one per DB role
from `SCHEMA.sql`:

| Pool token | Role | Can | Modules that inject it |
|---|---|---|---|
| `AUTH_POOL` | `auth_svc` | auth + narrow signup-bonus ledger grant | `AuthModule` |
| `LEDGER_POOL` | `txn_svc` | ledger writes; **no UPDATE/DELETE on `ledger.entries`** | `TransfersModule`, `ReversalsModule`, `DisputesModule`, `RequestsModule`, `BillsModule`, `GroupPaymentsModule` |
| `READ_POOL` | `read_svc` | **SELECT-only on ledger**, + `notify` writes | `QueryModule`, `NotificationsModule`, `AdminModule` |

A module can only do what its own pool's role is granted — that is enforced by
Postgres, not by convention. Splitting into separate processes is: give each
module its own process, and replace its pool's DI provider with an HTTP/event
adapter. Nothing else changes.

**Consequence for deployment:** the three DB URLs in `apps/api/.env`
(`AUTH_DATABASE_URL` / `LEDGER_DATABASE_URL` / `READ_DATABASE_URL`) are already
separate. A future deployment gives each service its own URL and its own
process; the SQL is untouched.

---

## 2. `ledger.outbox` is the durable event boundary — not Kafka

`SCHEMA.sql` line 319 and `ledger-writer.service.ts` (every money write):

- Every transfer / reversal / request settle / bill settle / group settle /
  hold settle writes an **outbox row in the SAME transaction** as the ledger
  (`INSERT INTO ledger.outbox (topic, payload) …`, `processed_at IS NULL`).
- The index `outbox_unprocessed ON ledger.outbox (id) WHERE processed_at IS NULL`
  keeps the relay scan small.
- **Nothing currently drains it** — a relay (a `WHERE processed_at IS NULL
  ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100` poller, per PLAN.md §4.1) is
  not yet implemented. It is the one missing piece for Kafka.

Topics already written (from `ledger-writer.service.ts` / `transfers.service.ts`
/ `sweeper.service.ts` / `disputes.service.ts` / `group-payments.service.ts`):

| Topic | When |
|---|---|
| `txn.completed` | normal transfer, hold settle, request settle, bill settle (the `moveMoney` default) |
| `txn.held` | above-threshold transfer / group transfer enters HELD |
| `txn.held_cancelled` | HELD transfer cancelled inside the undo window |
| `txn.reversed` | reversal / dispute-reverse |

`request.*` / `fraud.velocity` (API.md topics table) are reserved names — the
request lifecycle and fraud consumers are future work; money-request
settlements currently emit `txn.completed` via `moveMoney`.

**This is the "we don't queue money commands, we queue money facts" line**
(PLAN.md §7.4): the write path is synchronous; the outbox row commits with the
money; the broker can die and nothing is lost.

---

## 3. Notifications are written DIRECTLY today — that is the current (pre-Kafka) fallback

`ledger-writer.service.ts` also inserts `notify.notifications` rows **in the
same ACID transaction** (Round 6 decision) for `TRANSFER`, `HOLD_SETTLE`,
`HOLD_CANCEL`, `REVERSAL`, `REQUEST_SETTLE`, `BILL_SHARE_SETTLE`, etc. The
frontend reads them via `GET /notifications` (`READ_POOL`, `notify` schema).

> **Deployment note:** when the Kafka relay + notification consumer land, the
> direct `notify.notifications` insert can stay (idempotent, same transaction)
> **or** move to the consumer — both are wired to the same `READ_POOL`/`notify`
> schema. The seam is: `notify` is already a separate schema with `read_svc`
> write grants, so either path works without a schema change.

---

## 4. Centrifugo is configured and token-issuing — the bridge just needs a consumer

- `config.ts`: `centrifugoTokenSecret`, `centrifugoWsUrl`
  (`ws://localhost:8000/connection/websocket`), `CENTRIFUGO_*` envs.
- `POST /auth/ws-token` (`auth.controller.ts` → `auth.service.ts`): signs a
  Centrifugo connection token and returns
  `{ token, channel: 'user#'+userId, url }` — the **user-limited channel**
  form (`user#<id>`) so user A cannot subscribe to user B's channel.
- Infra: `docker-compose.yml` runs `centrifugo/centrifugo:v5` on `:8000`
  (`infra/centrifugo/config.json`).
- **Missing:** the consumer that reads `txn.completed`/`txn.held`/`txn.reversed`
  off Kafka and publishes to `user#<receiverId>` (PLAN.md §4.1 item 2 "Centrifugo
  bridge"). That consumer is a new process that subscribes to the same topics
  the relay produces — it does not change the write path.

---

## 5. The CQRS read/write split already exists in-process

- `modules/ledger/**` = write path (`LEDGER_POOL`).
- `modules/query/**` + `modules/notifications/**` = read path (`READ_POOL`,
  structurally cannot write the ledger).
- `AdminModule` reaches across deliberately (integrity reads + audit writes).

Deploying reads to a replica later: `QueryModule` already keys reads by user;
`ledger-writer.service.ts` comments note the balance is read-your-own-writes
from the primary. The repository seam (`apps/api/src/modules/ledger/core/*`) is
the single place primary/replica routing would be added.

---

## 6. What a deployment adds, in order (nothing is a rewrite)

1. **Outbox relay** — a poller process: `SELECT … FROM ledger.outbox WHERE
   processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100` → publish
   to Redpanda, `UPDATE … SET processed_at = now()`. One relay or many; SKIP
   LOCKED makes them safe. (New process, ~1 file.)
2. **Redpanda topics** — `txn.completed`, `txn.held`, `txn.reversed`,
   `request.*`, `fraud.velocity` (12–24 partitions each; partition count is the
   consumer-concurrency ceiling, expensive to change later — API.md "Kafka
   topics").
3. **Notification consumer** — subscribe to the topics, upsert
   `notify.notifications` (dedupe on `event_id`; Kafka is at-least-once — the
   dedupe table is the "no duplicate notification" guarantee, SIMULATOR CHA-06).
4. **Centrifugo bridge** — the same consumer (or a sibling) publishes to
   `user#<id>`. The frontend already subscribes on login with the `GET
   /auth/ws-token` token and falls back to balance refetch when the socket is
   down (UI_SPEC §0.4).
5. **Process split** — give Auth / Ledger / Query(+Notify+Admin) separate
   processes, swap each module's pool DI provider for an HTTP adapter. The
   three DB roles and the module boundaries are already in place.

The demo story stays the same: **kill Redpanda → transfers still commit, outbox
backs up → bring it back → events drain.** That's SIMULATOR.md CHA-02/03 and the
`ledger.outbox` behavior above — testable today without any of the new pieces.

---

## 7. Files that encode the seams (grep anchors)

| Concern | File |
|---|---|
| 3 pools / roles | `apps/api/src/db/db.module.ts` |
| roles & grants | `SCHEMA.sql` (lines ~403–432) |
| outbox write in same txn | `apps/api/src/modules/ledger/core/ledger-writer.service.ts` |
| outbox table | `SCHEMA.sql` (~319) |
| direct notifications (current path) | `ledger-writer.service.ts` (Round 6 block) |
| Centrifugo token + channel | `apps/api/src/modules/auth/auth.service.ts` (`wsToken`) |
| Centrifugo config | `apps/api/src/config.ts` + `infra/centrifugo/config.json` + `docker-compose.yml` |
| read-only boundary | `apps/api/src/modules/query/**` (READ_POOL only) |
| relay target SQL | PLAN.md §4.1 (relay pseudocode) |
| failure-mode tests | `sim/scenarios/chaos.ts` (CHA-02/03: kill redpanda, outbox intact) |