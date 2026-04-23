-- 012-add-outbound-relay-queue.sql
-- Durable queue for outbound cloud relay entries (bolt-history, scorebug, video-board).
-- Replaces the LevelDB-backed cloudRelayQueue namespace.

CREATE TABLE IF NOT EXISTS outbound_relay_queue (
  sequence       BIGSERIAL PRIMARY KEY,
  venue_id       TEXT NOT NULL,
  kind           TEXT NOT NULL,
  match_up_id    TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_created ON outbound_relay_queue(created_at);
