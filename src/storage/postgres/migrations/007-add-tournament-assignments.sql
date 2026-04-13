-- 007-add-tournament-assignments.sql
-- Explicit user↔tournament access grants. A PROVIDER_ADMIN or SUPER_ADMIN can
-- grant a user (who already has a user_providers row for the tournament's
-- provider) access to specific tournaments.

CREATE TABLE IF NOT EXISTS tournament_assignments (
  tournament_id   TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider_id     TEXT NOT NULL,
  assignment_role TEXT NOT NULL DEFAULT 'DIRECTOR',
  granted_by      UUID NOT NULL REFERENCES users(user_id),
  granted_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_assignments_user ON tournament_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_assignments_provider ON tournament_assignments(provider_id);
CREATE INDEX IF NOT EXISTS idx_tournament_assignments_user_provider ON tournament_assignments(user_id, provider_id);
