-- 045-add-participation-index.sql
-- AFFECTS: admin
--
-- Creates a NEW table and its indexes. It alters nothing existing, and no end-user surface
-- reads participation_index — the only reader is the role-gated GET /participation/... route.
-- Classified explicitly because the promote gate treats a missing header as end-user impact
-- (fail-safe loud), which is right as a default and wrong for this file.
--
-- A read model answering "what did this subject take part in", without a scan.
--
-- WHY THIS IS NOT CALENDAR MEMBERSHIP. A tournament lives in exactly ONE
-- provider's calendar -- `detachFromOtherCalendars` enforces it, deliberately,
-- so a moved tournament never lingers under its source provider. That makes
-- calendar membership unable to express a competition shared by two parties:
-- a college dual belongs to BOTH programmes, and putting it in the host's
-- calendar removes it from the visitor's. Participation is a different
-- relation from ownership and needs its own rows.
--
-- Crucially this also makes host attribution non-load-bearing. Participation
-- reads BOTH sides off every fixture, so a full home-and-away season is
-- available for 100% of them rather than for the 36% whose host the source
-- happens to state.
--
-- SUBJECT_TYPE, RATHER THAN A PERSON_ID COLUMN. Two consumers want these rows
-- at different grains: TEAM (a programme's season) and PERSON (a HiveID user's
-- own history, today served by an unbounded scan over every record). Keying on
-- (subject_type, subject_id) lets the second reuse this table instead of
-- migrating the same rows into a second one.
--
-- The denormalised name/date/count columns exist so a schedule renders from
-- this table alone. Deriving them at read time would mean loading every
-- referenced tournament record -- the unbounded cross-tournament read that
-- architectural-standard A7 forbids on a controller-reachable path, and the
-- exact defect this table is built to remove.

CREATE TABLE IF NOT EXISTS participation_index (
  subject_type    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  tournament_id   TEXT NOT NULL,
  participant_id  TEXT NOT NULL,
  provider_id     TEXT,
  tournament_name TEXT,
  start_date      DATE,
  end_date        DATE,
  event_count     INT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (subject_type, subject_id, tournament_id, participant_id)
);

-- The read path: every row for one subject, ordered by date. The primary key
-- already leads with (subject_type, subject_id), so this index earns its place
-- only by carrying start_date -- which is what makes "this team's season, in
-- order" an index-ordered read rather than a sort over the subject's rows.
CREATE INDEX IF NOT EXISTS idx_participation_subject_date
  ON participation_index (subject_type, subject_id, start_date);

-- The maintenance path: rewriting one tournament's rows on save deletes by
-- tournament_id, which the primary key cannot serve (it is not a prefix).
CREATE INDEX IF NOT EXISTS idx_participation_tournament
  ON participation_index (tournament_id);
