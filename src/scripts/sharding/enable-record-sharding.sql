-- enable-record-sharding.sql
--
-- Turns OPTIONAL record sharding on for this database: installs the tournaments_shard_sync trigger (migration 062).
-- Nothing is sharded by this alone. A tournament is sharded only when an operator then runs
--   SELECT set_tournament_storage_layout('<tournamentId>', 'sharded');
-- and from then on every write of its record rewrites its shards in the same transaction. With no tournament set to
-- `sharded`, a save pays one primary-key probe of the (empty) tournament_storage_layout table.
--
-- An OPERATOR step, not a migration: CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock on `tournaments`, which blocks
-- writes while it waits. Each attempt waits at most 2 s for the lock, then gives way and retries, up to 10 attempts.
-- Idempotent. Undo with disable-record-sharding.sql.
--
--   psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -f enable-record-sharding.sql
DO $$
DECLARE
  attempt INT := 0;
BEGIN
  LOOP
    attempt := attempt + 1;
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      EXECUTE 'CREATE OR REPLACE TRIGGER tournaments_shard_sync
                 AFTER INSERT OR UPDATE OF data OR DELETE ON tournaments
                 FOR EACH ROW EXECUTE FUNCTION tournaments_shard_sync()';
      RAISE NOTICE 'record sharding enabled (attempt %)', attempt;
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

SELECT 'record sharding: ' || CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgname = 'tournaments_shard_sync' AND tgrelid = 'tournaments'::regclass AND NOT tgisinternal)
       THEN 'enabled' ELSE 'NOT enabled' END AS result;
