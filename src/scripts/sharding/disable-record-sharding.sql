-- disable-record-sharding.sql
--
-- Turns OPTIONAL record sharding off: returns every sharded tournament to the `document` layout (dropping its shards)
-- and removes the tournaments_shard_sync trigger, in one transaction. `tournaments.data` is the record throughout, so
-- nothing is lost. Same lock discipline as enable-record-sharding.sql (DROP TRIGGER takes an ACCESS EXCLUSIVE lock).
--
--   psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -f disable-record-sharding.sql
DO $$
DECLARE
  attempt INT := 0;
BEGIN
  LOOP
    attempt := attempt + 1;
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      PERFORM set_tournament_storage_layout(tournament_id, 'document') FROM tournament_storage_layout;
      EXECUTE 'DROP TRIGGER IF EXISTS tournaments_shard_sync ON tournaments';
      RAISE NOTICE 'record sharding disabled (attempt %)', attempt;
      EXIT;
    EXCEPTION
      WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          RAISE EXCEPTION 'tournaments stayed busy through % attempts; nothing changed, try again later', attempt;
        END IF;
        RAISE NOTICE 'attempt %: tournaments is busy, waited 2 s for the lock; retrying in 3 s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
END
$$;

SELECT 'sharded tournaments remaining: ' || count(*) AS result FROM tournament_storage_layout WHERE layout = 'sharded';
