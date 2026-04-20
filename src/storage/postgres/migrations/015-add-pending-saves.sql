CREATE TABLE IF NOT EXISTS pending_saves (
  save_id          TEXT PRIMARY KEY,
  tournament_id    TEXT NOT NULL,
  user_id          UUID,
  user_email       TEXT,
  provider_id      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  validation_level TEXT DEFAULT 'L2',
  tournament_data  JSONB NOT NULL,
  errors           JSONB DEFAULT '[]',
  warnings         JSONB DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at     TIMESTAMPTZ,
  committed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_saves_status ON pending_saves(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_saves_tournament ON pending_saves(tournament_id);
