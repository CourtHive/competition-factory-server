-- 019-drop-stale-user-data-lastaccess.sql
-- Strip the now-redundant `lastAccess` field from `users.data` JSONB.
--
-- Mirror of migration 018 for the providers table — same root cause:
-- the LevelDB-era `updateLastAccess` for users wrote `lastAccess` into
-- the record body, the Postgres migration carried that field into the
-- `data` JSONB blob, and the read path's spread ordering let the stale
-- JSONB value shadow the canonical `last_access` column on every read.
--
-- Read path is now defensive (column wins on spread conflict). This
-- migration removes the stale field so the JSONB matches the column.
-- Idempotent — only affects rows where the field was actually present.

UPDATE users
   SET data = data - 'lastAccess'
 WHERE data ? 'lastAccess';
