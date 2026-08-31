-- 046-participation-issuing-organisation.sql
-- AFFECTS: admin
--
-- Adds a nullable column plus an index to the table 045 created. Additive, no backfill, no
-- end-user surface reads it. Same classification and same reason as 045.
--
-- Record WHICH BODY issued a subject's id.
--
-- `subject_id` is an id an organisation issued, not an id we minted, so it is only unique
-- WITHIN that organisation. Two bodies can both number a competitor "12345", and 045 had
-- nowhere to say which body a row's id came from. The rows themselves do not collide —
-- the primary key carries `participant_id`, which differs per competitor — but the READ
-- does: `listForSubject('TEAM', '12345')` would return both bodies' competitors as one
-- subject's history, silently merging two people or two programmes into one season.
--
-- That is the failure mode this index exists to prevent, one level up: a plausible,
-- longer-than-real history with nothing to signal the merge.
--
-- NULLABLE, and deliberately not added to the primary key. A NULL here means "issuer not
-- recorded" — true of every row written before this migration, and a fact rather than a
-- default. Backfilling a value we do not have would be an invention; those rows are
-- replaced with the issuer present the next time their tournament is saved, because
-- `replaceTournamentRows` rewrites a tournament's rows wholesale.
--
-- The primary key is left alone for the same reason: a NULL cannot participate in one,
-- and widening it would force a fabricated sentinel on exactly the rows whose issuer is
-- genuinely unknown.

ALTER TABLE participation_index
  ADD COLUMN IF NOT EXISTS organisation_id TEXT;

-- The disambiguating read: one subject, as issued by one body, in date order. Partial —
-- rows with no recorded issuer cannot be narrowed by one, and indexing them here would
-- cost writes to serve a query that can never match.
CREATE INDEX IF NOT EXISTS idx_participation_subject_org_date
  ON participation_index (subject_type, subject_id, organisation_id, start_date)
  WHERE organisation_id IS NOT NULL;
