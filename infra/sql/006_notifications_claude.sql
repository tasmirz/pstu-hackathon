-- ---------------------------------------------------------------------
-- Notifications: let txn_svc write directly into notify.notifications.
--
-- SCHEMA.sql already has the full shape for this — `ledger.outbox` (every
-- moveMoney call inserts a row there) and `notify.notifications` — designed
-- for the original 3-service split, where a Kafka relay drains the outbox
-- and a separate Notification service consumes it into this table. That
-- relay was explicitly deferred (TASKS_CLAUDE.md "explicitly out of scope"
-- — Kafka outbox relay/consumers aren't running yet).
--
-- Until it is, this monolith can be honest about the tradeoff instead of
-- half-building a relay that talks to nothing: `moveMoney` writes the
-- notification row in the SAME transaction as the ledger legs and the
-- outbox row. This is strictly *more* consistent than the eventual relay
-- (no redelivery window, no `notify.processed_events` needed) — it only
-- stops being true the day an external consumer (push notifications,
-- Centrifugo) needs the Kafka hop too, at which point this insert moves
-- from `moveMoney` to whatever drains `ledger.outbox`, unchanged in shape.
--
-- SCHEMA.sql only granted schema `notify` to `read_svc` (the query side).
-- txn_svc needs write access for the reason above.
-- ---------------------------------------------------------------------

GRANT USAGE ON SCHEMA notify TO txn_svc;
GRANT SELECT, INSERT ON notify.notifications TO txn_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA notify TO txn_svc;
