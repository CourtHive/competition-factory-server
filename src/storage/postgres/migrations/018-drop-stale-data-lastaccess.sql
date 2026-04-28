-- 018-drop-stale-data-lastaccess.sql
-- Strip the now-redundant `lastAccess` field from `providers.data` JSONB.
--
-- `last_access` was introduced as a dedicated TIMESTAMPTZ column in
-- migration 002, but at least one earlier write path also stored
-- `lastAccess` inside the `data` JSONB blob. The provider-storage read
-- path used to spread `...row.data` after the column-derived
-- `lastAccess`, so the stale JSONB value shadowed the column and the
-- admin Providers panel showed weeks-old timestamps despite the column
-- updating correctly.
--
-- The read path is now defensive (column wins on spread conflict), but
-- the stale field is still misleading on inspection / for any consumer
-- that reads the raw JSONB. This migration removes it for good.

UPDATE providers
   SET data = data - 'lastAccess'
 WHERE data ? 'lastAccess';
