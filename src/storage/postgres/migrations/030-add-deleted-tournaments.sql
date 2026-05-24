-- Archive of deleted tournament records so a delete is always recoverable.
-- Written (as a hard prerequisite) before any DELETE FROM tournaments, so the
-- full TODS record + who/when is retained even for an intentional deletion.
-- See incident 2026-05-23 (Battle of Boca): a hard delete with no server-side
-- copy was recoverable only because the TD happened to have the record open.

CREATE TABLE IF NOT EXISTS deleted_tournaments (
  tournament_id        TEXT NOT NULL,
  provider_id          TEXT,
  tournament_name      TEXT,
  start_date           DATE,
  end_date             DATE,
  data                 JSONB NOT NULL,
  deleted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by_user_id   UUID,
  deleted_by_email     TEXT,
  PRIMARY KEY (tournament_id, deleted_at)
);

CREATE INDEX IF NOT EXISTS idx_deleted_tournaments_provider ON deleted_tournaments (provider_id);
CREATE INDEX IF NOT EXISTS idx_deleted_tournaments_deleted_at ON deleted_tournaments (deleted_at DESC);
