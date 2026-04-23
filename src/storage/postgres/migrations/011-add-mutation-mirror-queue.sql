-- 011-add-mutation-mirror-queue.sql
-- Durable queue for mirroring mutations from local arena instances
-- to the upstream cloud factory-server. Sequence-ordered, with retry tracking.

CREATE TABLE IF NOT EXISTS mutation_mirror_queue (
  sequence       BIGSERIAL PRIMARY KEY,
  tournament_ids TEXT[] NOT NULL DEFAULT '{}',
  methods        JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);

CREATE INDEX IF NOT EXISTS idx_mirror_queue_created ON mutation_mirror_queue(created_at);
