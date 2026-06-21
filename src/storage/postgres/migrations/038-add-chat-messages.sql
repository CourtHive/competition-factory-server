-- 038-add-chat-messages.sql
-- AFFECTS: tournament chat
--
-- Persists tournament chat messages so a connecting client can backfill the
-- recent history, detect and fill gaps it missed while disconnected, and so a
-- super-admin can review chat across all tournaments/providers. Chat was
-- previously relay-only (TmxGateway.chatMessage broadcast to the tournament
-- room and forgot) — see Mentat/planning/TMX_PERSISTED_CHAT.md.
--
-- `seq` (BIGSERIAL) is the single authoritative ordering / gap-detection key.
-- Per-tournament contiguity is NOT required: "latest seq for this tournament"
-- vs the client's "last seen seq" is enough to detect a gap. provider_abbr +
-- tournament_name are denormalised so the admin monitor can render its
-- provider/tournament pills without a join.

CREATE TABLE IF NOT EXISTS chat_messages (
  seq             BIGSERIAL    PRIMARY KEY,
  tournament_id   TEXT         NOT NULL,
  provider_id     TEXT,
  provider_abbr   TEXT,
  tournament_name TEXT,
  user_name       TEXT         NOT NULL,
  message         TEXT         NOT NULL,
  client_msg_id   UUID,
  is_admin        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Backfill on join + since-seq gap fill are always (tournament_id, seq)-ordered.
CREATE INDEX IF NOT EXISTS chat_messages_tournament_seq_idx
  ON chat_messages (tournament_id, seq);

-- Admin monitor backfill (all tournaments, recent first) + retention prune
-- both scan by age.
CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx
  ON chat_messages (created_at);
