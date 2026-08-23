-- 044-add-tournament-grants.sql
--
-- Scoped, time-bounded capability grants.
--
-- `tournament_assignments` cannot carry scope: its primary key is
-- (tournament_id, user_id), so a user holds exactly one grant per tournament
-- and "SCORER on Court 7 AND DIRECTOR of the Boys 16s" is unrepresentable. It
-- also has no time bounds, while real delivery roles are shift-based — a grant
-- that never expires is wrong on day 3 of a 7-day event.
--
-- This table is ADDITIVE. `tournament_assignments` remains the coarse
-- visibility row that scopeCalendarForUser depends on in production; nothing
-- about existing behavior changes until a grant row exists.
--
-- `scope` is JSONB whose keys are drawn from the factory's existing
-- filterMatchUps vocabulary (eventIds, drawIds, structureIds, venueIds,
-- courtIds, scheduledDates, matchUpIds) rather than a second predicate
-- language. An EMPTY OBJECT means tournament-wide, which is the shipped
-- behavior — so a grant with no scope is exactly as permissive as today.

CREATE TABLE IF NOT EXISTS tournament_grants (
  grant_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  -- A capability name, not a role: roles are presets that expand to these.
  capability    TEXT NOT NULL,
  -- {} = tournament-wide. Keys validated in application code against a closed list.
  scope         JSONB NOT NULL DEFAULT '{}'::jsonb,
  not_before    TIMESTAMPTZ,
  not_after     TIMESTAMPTZ,
  granted_by    UUID REFERENCES users(user_id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The hot path: "what may this subject do on this tournament right now".
CREATE INDEX IF NOT EXISTS idx_tournament_grants_subject
  ON tournament_grants (user_id, tournament_id);

-- Revocation sweeps and the manage-access UI.
CREATE INDEX IF NOT EXISTS idx_tournament_grants_tournament
  ON tournament_grants (tournament_id);

CREATE INDEX IF NOT EXISTS idx_tournament_grants_provider
  ON tournament_grants (provider_id);
