-- 034-add-registration-entries.sql
--
-- HiveID Phase 2-A — Closing the Registration Loop (applicant side).
--
-- A `RegistrationEntry` is a hand-raised application from a HiveID user
-- against a published tournament. It is NOT yet a TODS Participant; the
-- director's TMX-side acceptance flow (Phase 2-B) is what fires
-- `addParticipants` into the factory and graduates an entry to a real
-- Participant. Until that moment, all applicant data lives in this
-- table, distinct from the canonical TODS surface.
--
-- State transitions (enforced at the service layer):
--   applied → accepted → seeded
--   applied → waitlisted → accepted
--   applied → withdrawn (terminal — applicant-initiated)
--   applied → rejected  (terminal — director-initiated)
--
-- `(tournament_id, user_id)` is unique: a HiveID user has at most one
-- registration row per tournament. Re-applying after withdrawal updates
-- the existing row rather than creating duplicates.
--
-- See Mentat/planning/HIVEID_INTEGRATION_PLAN.md § "Phase 2 — Closing
-- the Registration Loop" and the synthesis at
-- Mentat/queue/synthesis/roadmap-2026-05-30-hiveid-public-wedge.md.

CREATE TABLE IF NOT EXISTS registration_entries (
  registration_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id    text NOT NULL,
  user_id          uuid NOT NULL,
  person_id        uuid,
  event_ids        text[] NOT NULL DEFAULT ARRAY[]::text[],
  partner_user_id  uuid,
  answers          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'applied'
                   CHECK (status IN ('applied', 'accepted', 'seeded',
                                     'withdrawn', 'waitlisted', 'rejected')),
  status_reason    text,
  applied_at       timestamptz NOT NULL DEFAULT NOW(),
  status_at        timestamptz NOT NULL DEFAULT NOW(),
  decided_by_user_id uuid,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_registration_entries_tournament
  ON registration_entries (tournament_id, status);

CREATE INDEX IF NOT EXISTS idx_registration_entries_user
  ON registration_entries (user_id, status);

CREATE INDEX IF NOT EXISTS idx_registration_entries_person
  ON registration_entries (person_id)
  WHERE person_id IS NOT NULL;
