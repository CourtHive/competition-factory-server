-- 059-tournaments-data-lz4.sql
-- AFFECTS: end-users
--
-- Compress `tournaments.data` with lz4 instead of the default pglz. Every mutation rewrites the whole record
-- (TOAST-compressed on the way in), so compression sits on the write path of every score entry. Measured through
-- Postgres 18 on real records (Mentat planning/CFS_RECORD_SHARDING_EXPLORATION.md §3.2): for a 400 KiB record the
-- whole-row write fell from 6.5 ms to 3.8 ms and its WAL from 119 KiB to 90 KiB.
--
-- Metadata only: nothing is rewritten now. Rows convert as they are next written, and pglz rows stay readable, so
-- the column holds both until every record has been saved once.
--
-- lz4 needs Postgres 14+ built with lz4 (the default for distribution builds). Where it is unavailable this keeps
-- pglz and raises a WARNING rather than failing the migration: a failed migration stops the server from starting,
-- and compression is an optimisation, not something to take production down over.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE tournaments ALTER COLUMN data SET COMPRESSION lz4';
EXCEPTION
  WHEN feature_not_supported OR syntax_error OR invalid_parameter_value THEN
    RAISE WARNING '059: lz4 compression unavailable (%), tournaments.data keeps pglz', SQLERRM;
END
$$;
