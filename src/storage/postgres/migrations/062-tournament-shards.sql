-- 062-tournament-shards.sql
-- AFFECTS: admin
--
-- Shard tables and the functions that fill, reassemble and drop them: the dual-write stage of OPTIONAL record
-- sharding (Mentat planning/CFS_RECORD_SHARDING_EXPLORATION.md §7). Nothing reads from these tables yet, and nothing
-- writes them unless an operator enables sharding AND sets a tournament's layout to `sharded`:
--
--   1. src/scripts/sharding/enable-record-sharding.sql installs the tournaments_shard_sync trigger (it needs a lock on
--      `tournaments`, so it is an operator step with a lock timeout and retries, never a boot migration; see 059).
--   2. SELECT set_tournament_storage_layout('<tournamentId>', 'sharded'); shards that tournament and verifies the
--      reassembly equals its record, or refuses.
--
-- From then on every write of that tournament's `data`, by any writer, rewrites its shards in the same transaction
-- (rows that did not change are left alone), and deleting the tournament deletes them. `tournaments.data` stays the
-- record every read uses: tournament_document() is not switched to the shards here. The view tournament_shard_drift
-- lists any sharded tournament whose reassembly differs from its record, which should always be empty.
--
-- A shell is the record with `participants` and each event's `drawDefinitions` replaced by [] where they were arrays,
-- so reassembly restores exactly what was present. Rows are keyed by position, so the reassembled arrays keep their
-- order; participant_id and draw_id are indexed for lookups. match_up_index maps every matchUp (and TEAM tieMatchUp)
-- of a sharded tournament to its draw.
CREATE TABLE IF NOT EXISTS tournament_shells (
  tournament_id TEXT PRIMARY KEY,
  shell         JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS draw_definitions (
  tournament_id TEXT NOT NULL,
  event_ord     INT NOT NULL,
  ord           INT NOT NULL,
  event_id      TEXT,
  draw_id       TEXT,
  draw          JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, event_ord, ord)
);
CREATE INDEX IF NOT EXISTS draw_definitions_draw_id ON draw_definitions (tournament_id, draw_id);

CREATE TABLE IF NOT EXISTS tournament_participants (
  tournament_id  TEXT NOT NULL,
  ord            INT NOT NULL,
  participant_id TEXT,
  participant    JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, ord)
);
CREATE INDEX IF NOT EXISTS tournament_participants_participant_id ON tournament_participants (tournament_id, participant_id);

CREATE TABLE IF NOT EXISTS match_up_index (
  tournament_id TEXT NOT NULL,
  match_up_id   TEXT NOT NULL,
  event_id      TEXT,
  draw_id       TEXT,
  PRIMARY KEY (tournament_id, match_up_id)
);
CREATE INDEX IF NOT EXISTS match_up_index_match_up_id ON match_up_index (match_up_id);

-- The draws of a record, by position: (event_ord, ord) is the event's and the draw's index, 0-based.
CREATE OR REPLACE FUNCTION tournament_draw_rows(p_data JSONB)
RETURNS TABLE (event_ord INT, ord INT, event_id TEXT, draw_id TEXT, draw JSONB) LANGUAGE sql IMMUTABLE AS $$
  SELECT (x.e - 1)::int, (y.d - 1)::int, x.ev->>'eventId', y.dd->>'drawId', y.dd
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_data->'events') = 'array' THEN p_data->'events' ELSE '[]' END)
         WITH ORDINALITY AS x(ev, e),
         jsonb_array_elements(CASE WHEN jsonb_typeof(x.ev->'drawDefinitions') = 'array'
                                   THEN x.ev->'drawDefinitions' ELSE '[]' END)
         WITH ORDINALITY AS y(dd, d)
$$;

CREATE OR REPLACE FUNCTION drop_tournament_shards(p_tournament_id TEXT)
RETURNS VOID LANGUAGE sql AS $$
  DELETE FROM tournament_shells WHERE tournament_id = p_tournament_id;
  DELETE FROM draw_definitions WHERE tournament_id = p_tournament_id;
  DELETE FROM tournament_participants WHERE tournament_id = p_tournament_id;
  DELETE FROM match_up_index WHERE tournament_id = p_tournament_id;
$$;

CREATE OR REPLACE FUNCTION shard_tournament(p_tournament_id TEXT, p_data JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_shell  JSONB := p_data;
  v_events JSONB;
BEGIN
  IF jsonb_typeof(p_data->'participants') = 'array' THEN
    v_shell := jsonb_set(v_shell, '{participants}', '[]'::jsonb);
    INSERT INTO tournament_participants AS t (tournament_id, ord, participant_id, participant)
      SELECT p_tournament_id, (x.o - 1)::int, x.p->>'participantId', x.p
        FROM jsonb_array_elements(p_data->'participants') WITH ORDINALITY AS x(p, o)
    ON CONFLICT (tournament_id, ord) DO UPDATE
       SET participant_id = EXCLUDED.participant_id, participant = EXCLUDED.participant, updated_at = NOW()
     WHERE (t.participant_id, t.participant) IS DISTINCT FROM (EXCLUDED.participant_id, EXCLUDED.participant);
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

  INSERT INTO draw_definitions AS t (tournament_id, event_ord, ord, event_id, draw_id, draw)
    SELECT p_tournament_id, r.event_ord, r.ord, r.event_id, r.draw_id, r.draw FROM tournament_draw_rows(p_data) r
  ON CONFLICT (tournament_id, event_ord, ord) DO UPDATE
     SET event_id = EXCLUDED.event_id, draw_id = EXCLUDED.draw_id, draw = EXCLUDED.draw, updated_at = NOW()
   WHERE (t.event_id, t.draw_id, t.draw) IS DISTINCT FROM (EXCLUDED.event_id, EXCLUDED.draw_id, EXCLUDED.draw);
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

  INSERT INTO tournament_shells AS t (tournament_id, shell) VALUES (p_tournament_id, v_shell)
  ON CONFLICT (tournament_id) DO UPDATE SET shell = EXCLUDED.shell, updated_at = NOW()
   WHERE t.shell IS DISTINCT FROM EXCLUDED.shell;
END $$;

-- The record rebuilt from its shards; NULL when the tournament has no shell.
CREATE OR REPLACE FUNCTION tournament_reassemble(p_tournament_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT s.shell
         || CASE WHEN jsonb_typeof(s.shell->'participants') = 'array' THEN jsonb_build_object('participants',
              COALESCE((SELECT jsonb_agg(p.participant ORDER BY p.ord) FROM tournament_participants p
                         WHERE p.tournament_id = p_tournament_id), '[]'::jsonb))
            ELSE '{}'::jsonb END
         || CASE WHEN jsonb_typeof(s.shell->'events') = 'array' THEN jsonb_build_object('events',
              COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(x.ev->'drawDefinitions') = 'array'
                                              THEN jsonb_set(x.ev, '{drawDefinitions}',
                                                     COALESCE((SELECT jsonb_agg(d.draw ORDER BY d.ord)
                                                                 FROM draw_definitions d
                                                                WHERE d.tournament_id = p_tournament_id
                                                                  AND d.event_ord = x.e - 1), '[]'::jsonb))
                                              ELSE x.ev END ORDER BY x.e)
                          FROM jsonb_array_elements(s.shell->'events') WITH ORDINALITY AS x(ev, e)), '[]'::jsonb))
            ELSE '{}'::jsonb END
    FROM tournament_shells s
   WHERE s.tournament_id = p_tournament_id
$$;

-- Installed on `tournaments` only by src/scripts/sharding/enable-record-sharding.sql.
CREATE OR REPLACE FUNCTION tournaments_shard_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM drop_tournament_shards(OLD.tournament_id);
    DELETE FROM tournament_storage_layout WHERE tournament_id = OLD.tournament_id;
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM tournament_storage_layout
              WHERE tournament_id = NEW.tournament_id AND layout = 'sharded') THEN
    PERFORM shard_tournament(NEW.tournament_id, NEW.data);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION set_tournament_storage_layout(p_tournament_id TEXT, p_layout TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_data JSONB;
BEGIN
  IF p_layout = 'document' THEN
    DELETE FROM tournament_storage_layout WHERE tournament_id = p_tournament_id;
    PERFORM drop_tournament_shards(p_tournament_id);
    RETURN 'document';
  END IF;
  IF p_layout IS DISTINCT FROM 'sharded' THEN
    RAISE EXCEPTION 'unknown storage layout: %', p_layout;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'tournaments_shard_sync' AND tgrelid = 'tournaments'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'record sharding is not enabled: run src/scripts/sharding/enable-record-sharding.sql first';
  END IF;
  SELECT data INTO v_data FROM tournaments WHERE tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament not found: %', p_tournament_id;
  END IF;
  INSERT INTO tournament_storage_layout (tournament_id, layout) VALUES (p_tournament_id, 'sharded')
  ON CONFLICT (tournament_id) DO UPDATE SET layout = 'sharded', updated_at = NOW();
  PERFORM shard_tournament(p_tournament_id, v_data);
  IF tournament_reassemble(p_tournament_id) IS DISTINCT FROM v_data THEN
    RAISE EXCEPTION 'reassembled shards of % do not equal its record', p_tournament_id;
  END IF;
  RETURN 'sharded';
END $$;

-- Sharded tournaments whose reassembled shards differ from their record. Should always be empty.
CREATE OR REPLACE VIEW tournament_shard_drift AS
  SELECT t.tournament_id
    FROM tournament_storage_layout l
    JOIN tournaments t USING (tournament_id)
   WHERE l.layout = 'sharded'
     AND tournament_reassemble(t.tournament_id) IS DISTINCT FROM t.data;
