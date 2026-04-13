-- 008-add-audit-log.sql
-- Append-only audit trail for tournament mutations. No FK to tournaments —
-- audit rows survive tournament deletion intentionally.

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id       TEXT PRIMARY KEY,
  tournament_id  TEXT NOT NULL,
  user_id        UUID,
  user_email     TEXT,
  source         TEXT DEFAULT 'tmx',
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action_type    TEXT NOT NULL DEFAULT 'MUTATION',
  methods        JSONB DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'applied',
  metadata       JSONB DEFAULT '{}',
  error_code     TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tournament ON audit_log(tournament_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action_type);
