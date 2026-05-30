-- 033-add-user-person-link.sql
--
-- HiveID Integration Phase 1 PR-E.
-- Extends the `users` table with the HiveID fields locked in
-- Mentat/planning/HIVEID_INTEGRATION_PLAN.md.
--
-- HiveID composes with the existing courthive-persons microservice:
-- HiveID (= a credentialed `users` row) -> canonical Person -> many
-- TODS Participants. This migration adds the linkage layer.
--
-- Field notes:
--   person_id              Logical FK to courthive-persons.persons.person_id.
--                          NOT a Postgres FK constraint — persons lives in
--                          a SEPARATE database (`courthive_persons`) per
--                          the Option-A decision 2026-05-30. Validation is
--                          at the application layer (IUserStorage.setPersonLink).
--   standard_family_name   Cached canonical surname from persons. Refreshed
--   standard_given_name    on personMerged event or person_revision mismatch.
--   birth_date             Lets the public-facing pages keep working when
--   sex                    courthive-persons is briefly unreachable.
--   nationality_code
--   person_revision        Monotonic revision read from persons.person_revision
--                          at the time of caching. NULL = not yet linked.
--                          Compare against current revision; refetch on
--                          mismatch.
--   consent_preferences    JSONB blob for public-side opt-in flags (push
--                          notifications, marketing, channel preferences,
--                          etc.). Schema is intentionally unconstrained at
--                          the SQL layer.
--
-- Backfill of `person_id` from PR-C's CSV is a separate operator-driven
-- step (out of scope for this migration). Until that runs, person_id stays
-- NULL on existing rows and the application layer treats NULL as
-- "not yet linked, mint on first claim".

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS person_id uuid,
  ADD COLUMN IF NOT EXISTS standard_family_name text,
  ADD COLUMN IF NOT EXISTS standard_given_name text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS nationality_code text,
  ADD COLUMN IF NOT EXISTS person_revision integer,
  ADD COLUMN IF NOT EXISTS consent_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Partial index so the FK lookup (`WHERE person_id = $1`) is fast without
-- bloating the index with NULL entries for not-yet-linked rows.
CREATE INDEX IF NOT EXISTS idx_users_person_id
  ON users (person_id) WHERE person_id IS NOT NULL;
