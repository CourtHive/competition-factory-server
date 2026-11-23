-- AFFECTS: end-users
-- Process-local cache validators for migration 062's physical JSON bodies. A validator is only
-- comparable at the same physical row key on the same relation/database. Membership, order,
-- logical IDs, active layout/trigger and parent revision still come from the reader's snapshot.
--
-- Existing rows get a per-relation literal fast default (no heap rewrite). Dropping the default
-- retains the missing-column value for those rows. Future inserts/updates get a fresh UUID even
-- when peers reuse IDs, supply an old token, or write twice within the same transaction.
CREATE OR REPLACE FUNCTION stamp_shard_cache_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.cache_revision := pg_catalog.gen_random_uuid();
  RETURN NEW;
END $$;

DO $$
DECLARE
  part regclass;
BEGIN
  FOREACH part IN ARRAY ARRAY['tournament_shells'::regclass, 'draw_definitions'::regclass,
                              'tournament_participants'::regclass] LOOP
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS cache_revision uuid NOT NULL DEFAULT %L::uuid',
                   part, pg_catalog.gen_random_uuid());
    EXECUTE format('ALTER TABLE %s ALTER COLUMN cache_revision DROP DEFAULT', part);
    EXECUTE format('CREATE OR REPLACE TRIGGER shard_cache_revision BEFORE INSERT OR UPDATE ON %s
                    FOR EACH ROW EXECUTE FUNCTION stamp_shard_cache_revision()', part);
    EXECUTE format('ALTER TABLE %s ENABLE ALWAYS TRIGGER shard_cache_revision', part);
  END LOOP;
END $$;

-- Both 062 callers already hold the parent row lock: the parent-write trigger and the locked
-- layout conversion. MERGE chooses the action before firing row triggers. An unchanged match
-- performs no row write and generates no revision. The positional keys, cleanup, match index
-- and shell projection below preserve 062 semantics. Document-layout saves never enter here.
CREATE OR REPLACE FUNCTION shard_tournament(p_tournament_id TEXT, p_data JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_shell  JSONB := p_data;
  v_events JSONB;
BEGIN
  IF jsonb_typeof(p_data->'participants') = 'array' THEN
    v_shell := jsonb_set(v_shell, '{participants}', '[]'::jsonb);
    MERGE INTO tournament_participants AS t
    USING (
      SELECT (x.o - 1)::int AS ord, x.p->>'participantId' AS participant_id, x.p AS participant
        FROM jsonb_array_elements(p_data->'participants') WITH ORDINALITY AS x(p, o)
    ) AS s
    ON t.tournament_id = p_tournament_id AND t.ord = s.ord
    WHEN MATCHED AND (t.participant_id, t.participant) IS DISTINCT FROM (s.participant_id, s.participant)
      THEN UPDATE SET participant_id = s.participant_id, participant = s.participant, updated_at = NOW()
    WHEN NOT MATCHED THEN INSERT (tournament_id, ord, participant_id, participant)
      VALUES (p_tournament_id, s.ord, s.participant_id, s.participant);
    DELETE FROM tournament_participants
     WHERE tournament_id = p_tournament_id AND ord >= jsonb_array_length(p_data->'participants');
  ELSE
    DELETE FROM tournament_participants WHERE tournament_id = p_tournament_id;
  END IF;

  IF jsonb_typeof(p_data->'events') = 'array' THEN
    SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(x.ev->'drawDefinitions') = 'array'
                                   THEN jsonb_set(x.ev, '{drawDefinitions}', '[]'::jsonb) ELSE x.ev END
                              ORDER BY x.e), '[]'::jsonb)
      INTO v_events
      FROM jsonb_array_elements(p_data->'events') WITH ORDINALITY AS x(ev, e);
    v_shell := jsonb_set(v_shell, '{events}', v_events);
  END IF;

  MERGE INTO draw_definitions AS t
  USING tournament_draw_rows(p_data) AS s
  ON t.tournament_id = p_tournament_id AND t.event_ord = s.event_ord AND t.ord = s.ord
  WHEN MATCHED AND (t.event_id, t.draw_id, t.draw) IS DISTINCT FROM (s.event_id, s.draw_id, s.draw)
    THEN UPDATE SET event_id = s.event_id, draw_id = s.draw_id, draw = s.draw, updated_at = NOW()
  WHEN NOT MATCHED THEN INSERT (tournament_id, event_ord, ord, event_id, draw_id, draw)
    VALUES (p_tournament_id, s.event_ord, s.ord, s.event_id, s.draw_id, s.draw);
  DELETE FROM draw_definitions t
   WHERE t.tournament_id = p_tournament_id
     AND NOT EXISTS (SELECT 1 FROM tournament_draw_rows(p_data) r WHERE r.event_ord = t.event_ord AND r.ord = t.ord);

  -- Every matchUp of every structure (round robin groups nest one level) and every TEAM tieMatchUp.
  WITH src AS (
    SELECT DISTINCT ON (m->>'matchUpId') m->>'matchUpId' AS match_up_id, r.event_id, r.draw_id
      FROM tournament_draw_rows(p_data) r,
           LATERAL (
             SELECT jsonb_path_query(r.draw, 'lax $.structures[*].matchUps[*]') AS m
             UNION ALL SELECT jsonb_path_query(r.draw, 'lax $.structures[*].matchUps[*].tieMatchUps[*]')
             UNION ALL SELECT jsonb_path_query(r.draw, 'lax $.structures[*].structures[*].matchUps[*]')
             UNION ALL SELECT jsonb_path_query(r.draw, 'lax $.structures[*].structures[*].matchUps[*].tieMatchUps[*]')
           ) mu
     WHERE m->>'matchUpId' IS NOT NULL
     ORDER BY m->>'matchUpId', r.event_ord, r.ord
  ), upserted AS (
    INSERT INTO match_up_index AS t (tournament_id, match_up_id, event_id, draw_id)
      SELECT p_tournament_id, src.match_up_id, src.event_id, src.draw_id FROM src
    ON CONFLICT (tournament_id, match_up_id) DO UPDATE
       SET event_id = EXCLUDED.event_id, draw_id = EXCLUDED.draw_id
     WHERE (t.event_id, t.draw_id) IS DISTINCT FROM (EXCLUDED.event_id, EXCLUDED.draw_id)
    RETURNING 1
  )
  DELETE FROM match_up_index t
   WHERE t.tournament_id = p_tournament_id
     AND NOT EXISTS (SELECT 1 FROM src WHERE src.match_up_id = t.match_up_id);

  MERGE INTO tournament_shells AS t
  USING (VALUES (p_tournament_id, v_shell)) AS s(tournament_id, shell)
  ON t.tournament_id = s.tournament_id
  WHEN MATCHED AND t.shell IS DISTINCT FROM s.shell THEN UPDATE SET shell = s.shell, updated_at = NOW()
  WHEN NOT MATCHED THEN INSERT (tournament_id, shell) VALUES (s.tournament_id, s.shell);
END $$;
