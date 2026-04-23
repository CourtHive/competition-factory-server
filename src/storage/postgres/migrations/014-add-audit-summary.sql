CREATE TABLE IF NOT EXISTS audit_summary (
  summary_id     TEXT PRIMARY KEY,
  tournament_id  TEXT NOT NULL,
  report_type    TEXT NOT NULL,
  condensed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_date      TIMESTAMPTZ,
  to_date        TIMESTAMPTZ,
  data           JSONB NOT NULL DEFAULT '{}',
  row_count      INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_audit_summary_tournament ON audit_summary(tournament_id, report_type);
CREATE INDEX IF NOT EXISTS idx_audit_summary_type ON audit_summary(report_type);
