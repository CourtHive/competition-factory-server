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
