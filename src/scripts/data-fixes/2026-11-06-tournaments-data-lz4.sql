-- 2026-11-06-tournaments-data-lz4.sql
--
-- Compress `tournaments.data` with lz4 instead of pglz. Measured through Postgres 18 on real records (Mentat
-- planning/CFS_RECORD_SHARDING_EXPLORATION.md §3.2): a 400 KiB record's whole-row write fell from 6.5 ms to 3.8 ms and
-- its WAL from 119 KiB to 90 KiB. Metadata only: no row is rewritten now; rows convert as they are next saved, and pglz
-- rows stay readable.
--
-- An OPERATOR step, not a migration (see migration 059): SET COMPRESSION takes an ACCESS EXCLUSIVE lock on
-- `tournaments`, so it must never wait in line in front of live traffic. Each attempt waits at most 2 s for the lock
-- (`lock_timeout`), then gives way and retries, up to 10 attempts; a busy table is left untouched rather than stalled.
-- Idempotent: re-running it on an lz4 column is a no-op.
--
-- Run on the CFS database at a quiet moment, with the CFS credentials (see Mentat reference_cfs_prod_db_access):
--   psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -f 2026-11-06-tournaments-data-lz4.sql
-- The last line prints the column's compression: `l` is lz4.
DO $$
DECLARE
  attempt INT := 0;
BEGIN
  LOOP
    attempt := attempt + 1;
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      EXECUTE 'ALTER TABLE tournaments ALTER COLUMN data SET COMPRESSION lz4';
      RAISE NOTICE 'tournaments.data set to lz4 (attempt %)', attempt;
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

SELECT 'tournaments.data compression: ' || COALESCE(NULLIF(attcompression::text, ''), 'default (pglz)') AS result
  FROM pg_attribute
 WHERE attrelid = 'tournaments'::regclass AND attname = 'data';
