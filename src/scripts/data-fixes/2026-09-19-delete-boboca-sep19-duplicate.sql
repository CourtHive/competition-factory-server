-- 2026-09-19-delete-boboca-sep19-duplicate.sql
--
-- Delete the duplicate BOBOCA tournament e1be2db7-fb79-4593-b7ab-869834d578b4
-- ("Battle of Boca - Sep 19"), a second copy of the same IONSport source push that
-- produced 2daed315-9260-4f8a-9db6-bddb4bf2d53b ("Battle of Boca - September 19") —
-- the tournament BOBOCA is RUNNING TODAY.
--
-- Authorised by CA 2026-09-19.
--
-- WHY THE DUPLICATE IS DANGEROUS RATHER THAN MERELY UNTIDY
-- Both copies carry the SAME source-system ids: events 612669-612672 and draw
-- b9979b56-0a35-43eb-a6f2-405c1fbcdf13. The read model keys three tables on ids that
-- are only unique WITHIN a tournament:
--
--   query_events      PRIMARY KEY (event_id)
--   query_draws       PRIMARY KEY (draw_id)
--   query_match_ups   PRIMARY KEY (match_up_id)
--   query_entries     PRIMARY KEY (tournament_id, event_id, participant_id)  <- correct
--
-- So the two copies fight over one set of rows and the last projection wins. Measured
-- today: the duplicate holds 0 events / 0 draws / 0 structures / 0 matchUps (and 100
-- entries + 26 seeds, which are correctly keyed), while the live tournament holds
-- 4 / 3 / 3 / 101. The live copy owns them only because it was last touched at
-- 10:38 today. ANY save against the duplicate flips them back and strips the live
-- tournament's read model mid-event.
--
-- WHY SQL AND NOT THE APPLICATION DELETE
-- Not merely a missing token this time — the supported path REFUSES:
-- `checkDeletableByEndDate` (tournament-storage.service.ts:264) blocks deletion until
-- `endDate` is in the past, and this record ends 2026-09-22. Its own error text
-- prescribes the workaround: "Set the end date to a past date first, then delete."
-- That edit is a SAVE, and a save is exactly the projection flip described above. On
-- any other day it would be the right instrument; today it is the one thing that must
-- not happen. So this script reproduces the delete path's end state directly.
--
-- WHAT THE APPLICATION PATH DOES, AND HOW THIS MIRRORS IT
-- (deleteSingleTournament, tournament-storage.service.ts:169-246)
--
--   1. authorize                     -> CA's instruction stands in for it
--   2. end-date guard                -> deliberately bypassed, see above
--   3. archive to deleted_tournaments -> step 2 below; HARD prerequisite, same as the app
--   4. audit (fail-soft)             -> step 3; DELETE_TOURNAMENT, mirroring recordDeletion
--   5. remove the tournaments row    -> step 4
--   6. detach from its own calendar  -> step 5, provider verified as removeFromCalendar does
--   7. drop participation_index rows -> step 6
--   8. enqueue the read-model delete -> step 7, applied DIRECTLY rather than through the
--                                       outbox: the consumer's delta is
--                                       `DELETE FROM query_tournaments WHERE tournament_id = $1`
--                                       and the 10 child tables cascade from it
--                                       (ON DELETE CASCADE on tournament_id, verified).
--                                       Doing it inline keeps it inside this transaction.
--
-- THE INVARIANT THIS SCRIPT EXISTS TO PROTECT
-- Step 8 is safe ONLY because the collided rows currently carry the LIVE tournament's
-- tournament_id, so a cascade keyed on the duplicate's id cannot reach them. That is
-- asserted BEFORE the delete (step 1) and again AFTER (step 8) — if the live
-- tournament's read model is not intact at both ends, the whole transaction aborts.
--
-- Idempotent and transaction-wrapped: the guard aborts if the duplicate is already gone.
--
-- Usage on courthive-mentat (writes against the nest prod DB):
--
--   PGPASSWORD=… psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DATABASE" \
--     -f src/scripts/data-fixes/2026-09-19-delete-boboca-sep19-duplicate.sql

\set ON_ERROR_STOP on
\pset pager off

\set dup  '''e1be2db7-fb79-4593-b7ab-869834d578b4'''
\set keep '''2daed315-9260-4f8a-9db6-bddb4bf2d53b'''
\set boboca '''24bf9f25-96ca-401e-9660-f5571ebc50ba'''

BEGIN;

-- ============================================================================
-- 1) Guard — the duplicate must be what we think, and the LIVE record must be whole
-- ============================================================================

DO $$
DECLARE
  dup_provider   TEXT;
  dup_name       TEXT;
  keep_events    INT;
  keep_draws     INT;
  keep_matchups  INT;
BEGIN
  SELECT provider_id, tournament_name INTO dup_provider, dup_name
    FROM tournaments WHERE tournament_id = 'e1be2db7-fb79-4593-b7ab-869834d578b4';

  IF dup_provider IS NULL THEN
    RAISE EXCEPTION 'Duplicate e1be2db7-… not found — already deleted (re-run of a completed delete)';
  END IF;

  IF dup_provider <> '24bf9f25-96ca-401e-9660-f5571ebc50ba' THEN
    RAISE EXCEPTION 'Refusing: duplicate is not under BOBOCA, found provider %', dup_provider;
  END IF;

  IF dup_name <> 'Battle of Boca - Sep 19' THEN
    RAISE EXCEPTION 'Refusing: expected name "Battle of Boca - Sep 19", found "%"', dup_name;
  END IF;

  -- The record we must NOT harm has to exist...
  IF NOT EXISTS (SELECT 1 FROM tournaments
                  WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b') THEN
    RAISE EXCEPTION 'Refusing: the live tournament 2daed315-… is missing';
  END IF;

  -- ...and must currently OWN the collided read-model rows. If it does not, the
  -- duplicate owns them, and deleting the duplicate would cascade them away.
  SELECT (SELECT count(*) FROM query_events    WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM query_draws     WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM query_match_ups WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b')
    INTO keep_events, keep_draws, keep_matchups;

  IF keep_events < 4 OR keep_draws < 3 OR keep_matchups < 101 THEN
    RAISE EXCEPTION
      'REFUSING: the live tournament does not own its read model (events=%, draws=%, matchUps=%; expected >= 4/3/101). '
      'The duplicate may hold them — deleting it would cascade them away. Re-project the live tournament first.',
      keep_events, keep_draws, keep_matchups;
  END IF;
END $$;

\echo == BEFORE — the duplicate ==
SELECT tournament_id, tournament_name, start_date, end_date, created_at, updated_at
  FROM tournaments WHERE tournament_id = :dup;

\echo == BEFORE — read-model footprint of each ==
SELECT 'duplicate' AS which,
       (SELECT count(*) FROM query_events    WHERE tournament_id = :dup) AS events,
       (SELECT count(*) FROM query_draws     WHERE tournament_id = :dup) AS draws,
       (SELECT count(*) FROM query_match_ups WHERE tournament_id = :dup) AS match_ups,
       (SELECT count(*) FROM query_entries   WHERE tournament_id = :dup) AS entries,
       (SELECT count(*) FROM query_seeds     WHERE tournament_id = :dup) AS seeds
UNION ALL
SELECT 'live',
       (SELECT count(*) FROM query_events    WHERE tournament_id = :keep),
       (SELECT count(*) FROM query_draws     WHERE tournament_id = :keep),
       (SELECT count(*) FROM query_match_ups WHERE tournament_id = :keep),
       (SELECT count(*) FROM query_entries   WHERE tournament_id = :keep),
       (SELECT count(*) FROM query_seeds     WHERE tournament_id = :keep);

-- ============================================================================
-- 2) Archive — the app's HARD prerequisite, same columns as archiveTournamentRecord
-- ============================================================================
-- postgres-tournament.storage.ts:217. `deleted_tournaments.data` holds the whole
-- record, so the delete stays recoverable via revive tooling.

INSERT INTO deleted_tournaments
  (tournament_id, provider_id, tournament_name, start_date, end_date, data,
   deleted_by_user_id, deleted_by_email)
SELECT t.tournament_id,
       t.data->'parentOrganisation'->>'organisationId',
       t.data->>'tournamentName',
       -- `startDate`/`endDate` are calendar-date STRINGS in the record and DATE columns
       -- here, so cast explicitly. NULLIF guards the empty string, which ::date rejects.
       NULLIF(t.data->>'startDate', '')::date,
       NULLIF(t.data->>'endDate', '')::date,
       t.data,
       NULL,                      -- no JWT actor: applied by data-fix script
       'charles@courthive.com'    -- the authorising operator
  FROM tournaments t
 WHERE t.tournament_id = :dup;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deleted_tournaments
                  WHERE tournament_id = 'e1be2db7-fb79-4593-b7ab-869834d578b4') THEN
    RAISE EXCEPTION 'Archive did not land — aborting, exactly as the application does';
  END IF;
END $$;

\echo == archived ==
SELECT tournament_id, tournament_name, deleted_at,
       jsonb_array_length(data->'events') AS events_archived,
       jsonb_array_length(data->'participants') AS participants_archived
  FROM deleted_tournaments WHERE tournament_id = :dup;

-- ============================================================================
-- 3) Audit — mirroring AuditService.recordDeletion (audit.service.ts:211)
-- ============================================================================
-- `source` is 'script' rather than 'tmx': this did not come through the client, and
-- saying 'tmx' would misattribute it. actor_type/actor_id name the provider, as
-- toActor({ providerId }) would.

INSERT INTO audit_log
  (audit_id, tournament_id, user_id, user_email, source, occurred_at,
   action_type, methods, status, metadata, actor_type, actor_id)
VALUES
  (gen_random_uuid()::text, :dup, NULL, 'charles@courthive.com', 'script', NOW(),
   'DELETE_TOURNAMENT',
   '[{"method": "removeTournamentRecords"}]'::jsonb,
   'applied',
   jsonb_build_object(
     'tournamentName', 'Battle of Boca - Sep 19',
     'providerId', '24bf9f25-96ca-401e-9660-f5571ebc50ba',
     'reason', 'duplicate of 2daed315-9260-4f8a-9db6-bddb4bf2d53b; identical source event/draw ids collided in the read model',
     'script', '2026-09-19-delete-boboca-sep19-duplicate.sql',
     'authorisedBy', 'CA 2026-09-19'),
   'provider', '24bf9f25-96ca-401e-9660-f5571ebc50ba');

-- ============================================================================
-- 4) Remove the tournament record
-- ============================================================================

DELETE FROM tournaments WHERE tournament_id = :dup;

-- ============================================================================
-- 5) Detach from BOBOCA's calendar
-- ============================================================================
-- `removeFromCalendar` verifies the providerId before deleting rather than ignoring
-- it, so that a mistaken provider is never silent data loss. Same check here.

DELETE FROM calendar_tournaments
 WHERE tournament_id = :dup AND provider_id = :boboca;

-- ============================================================================
-- 6) Participation index — keyed by tournament_id, no FK to cascade from
-- ============================================================================

DELETE FROM participation_index WHERE tournament_id = :dup;

-- ============================================================================
-- 7) Read model — the delta the projection consumer would apply
-- ============================================================================
-- One statement; the 10 child tables cascade from it on tournament_id.

DELETE FROM query_tournaments WHERE tournament_id = :dup;

-- ============================================================================
-- 8) Post-state — the duplicate is gone, and the LIVE record is untouched
-- ============================================================================

\echo == AFTER — nothing anywhere references the duplicate ==
SELECT 'tournaments' AS tbl, count(*) FROM tournaments WHERE tournament_id = :dup
UNION ALL SELECT 'calendar_tournaments', count(*) FROM calendar_tournaments WHERE tournament_id = :dup
UNION ALL SELECT 'participation_index', count(*) FROM participation_index WHERE tournament_id = :dup
UNION ALL SELECT 'query_tournaments', count(*) FROM query_tournaments WHERE tournament_id = :dup
UNION ALL SELECT 'query_tournament_discovery', count(*) FROM query_tournament_discovery WHERE tournament_id = :dup
UNION ALL SELECT 'query_entries', count(*) FROM query_entries WHERE tournament_id = :dup
UNION ALL SELECT 'query_seeds', count(*) FROM query_seeds WHERE tournament_id = :dup
UNION ALL SELECT 'deleted_tournaments (archive — expect 1)', count(*) FROM deleted_tournaments WHERE tournament_id = :dup
ORDER BY 1;

\echo == AFTER — the LIVE tournament, which must be unchanged ==
SELECT (SELECT count(*) FROM query_events    WHERE tournament_id = :keep) AS events,
       (SELECT count(*) FROM query_draws     WHERE tournament_id = :keep) AS draws,
       (SELECT count(*) FROM query_structures WHERE tournament_id = :keep) AS structures,
       (SELECT count(*) FROM query_match_ups WHERE tournament_id = :keep) AS match_ups,
       (SELECT count(*) FROM query_entries   WHERE tournament_id = :keep) AS entries,
       (SELECT count(*) FROM calendar_tournaments WHERE tournament_id = :keep) AS calendar_row,
       (SELECT count(*) FROM tournaments     WHERE tournament_id = :keep) AS record;

DO $$
DECLARE
  e INT; d INT; s INT; m INT; en INT; cal INT; rec INT;
BEGIN
  SELECT (SELECT count(*) FROM query_events     WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM query_draws      WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM query_structures WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM query_match_ups  WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM query_entries    WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM calendar_tournaments WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b'),
         (SELECT count(*) FROM tournaments      WHERE tournament_id = '2daed315-9260-4f8a-9db6-bddb4bf2d53b')
    INTO e, d, s, m, en, cal, rec;

  IF e < 4 OR d < 3 OR s < 3 OR m < 101 OR en < 100 OR cal <> 1 OR rec <> 1 THEN
    RAISE EXCEPTION
      'ABORTING: the live tournament was harmed (events=%, draws=%, structures=%, matchUps=%, entries=%, calendar=%, record=%)',
      e, d, s, m, en, cal, rec;
  END IF;

  IF EXISTS (SELECT 1 FROM tournaments WHERE tournament_id = 'e1be2db7-fb79-4593-b7ab-869834d578b4') THEN
    RAISE EXCEPTION 'ABORTING: the duplicate record still exists';
  END IF;
END $$;

COMMIT;
\echo == done — duplicate deleted, archived in deleted_tournaments, live tournament verified intact ==
