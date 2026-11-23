// Migration 067. Evaluate once per warm SELECT, in the same snapshot as the parts. Ordinary
// document/cold reads do not need this catalog lookup. Require ALWAYS because a writer may use
// replica mode. A privileged maintenance interval with stamping disabled requires restamping
// affected rows before warm reads resume; the catalog shows today's configuration only.
export const ACTIVE_SHARD_CACHE_REVISIONS_SQL = `(
  SELECT count(*) = 3
    FROM pg_catalog.pg_trigger tr
    JOIN pg_catalog.pg_proc fn ON fn.oid = tr.tgfoid
    JOIN pg_catalog.pg_class rel ON rel.oid = tr.tgrelid AND rel.relnamespace = fn.pronamespace
   WHERE tr.tgrelid IN ('tournament_shells'::regclass, 'draw_definitions'::regclass, 'tournament_participants'::regclass)
     AND tr.tgname = 'shard_cache_revision' AND tr.tgenabled = 'A' AND NOT tr.tgisinternal
     AND fn.proname = 'stamp_shard_cache_revision' AND fn.pronargs = 0
     AND tr.tgtype = 23 AND tr.tgattr::text = '' AND tr.tgnargs = 0 AND tr.tgqual IS NULL
)`;
