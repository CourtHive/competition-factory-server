-- 054-command-receipts.sql
-- AFFECTS: admin
-- Durable mutation receipts (src/storage/postgres/COMMAND_RECEIPTS.md): one row per (actor, commandId), written in the
-- same transaction as the mutation it acknowledges. A new internal table; no existing table changes. Numbered 054:
-- 052 is draft #1017's, 053 drops pending_saves, 055 is the projection snapshot work.
-- Retain receipts without a TTL: a browser may recover an old command after a long outage.
-- Pruning requires an explicit maximum retry age/protocol; deleting receipts silently would permit reapplication.
CREATE TABLE IF NOT EXISTS command_receipts (
  actor TEXT NOT NULL,
  command_id VARCHAR(128) NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  result JSONB NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor, command_id)
);
