// Migration 062's operator-installed AFTER INSERT OR UPDATE OF data OR DELETE FOR EACH ROW trigger.
// Use in the reading statement itself, with the parent tournaments row aliased as t.
// This checks current configuration. After an unsynchronized interval operators must re-shard and verify drift.
export const ACTIVE_SHARD_SYNC_SQL = `EXISTS (
  SELECT 1
    FROM pg_catalog.pg_trigger sync
    JOIN pg_catalog.pg_proc fn ON fn.oid = sync.tgfoid
    JOIN pg_catalog.pg_class rel ON rel.oid = sync.tgrelid AND rel.relnamespace = fn.pronamespace
    JOIN pg_catalog.pg_attribute col ON col.attrelid = rel.oid AND col.attname = 'data'
   WHERE rel.oid = t.tableoid AND sync.tgname = 'tournaments_shard_sync'
     AND fn.proname = 'tournaments_shard_sync' AND fn.pronargs = 0
     AND NOT sync.tgisinternal AND sync.tgtype = 29 AND sync.tgqual IS NULL
     AND sync.tgnargs = 0 AND sync.tgattr::text = col.attnum::text
     AND (sync.tgenabled = 'A' OR (sync.tgenabled = 'O' AND current_setting('session_replication_role') <> 'replica'))
)`;
