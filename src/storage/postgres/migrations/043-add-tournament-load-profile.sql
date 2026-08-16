-- 043-add-tournament-load-profile.sql
-- Per-tournament mutation load telemetry (Stage 0 of tournament-affinity
-- sharding, planning/CFS_TOURNAMENT_AFFINITY_SHARDING.md).
--
-- WHY: CFS has never had per-tournament cost attribution. Every claim about
-- where the mutation path spends its time is currently inference from code
-- shape — that the whole-document JSONB read-modify-write dominates, that the
-- corpus is overwhelmingly cold, that a marquee event's serialisation latency
-- is charged to everyone sharing its event loop. None of that is measured, and
-- the decision that follows (whether to build an in-memory record cache, and
-- how to size affinity pools) should not be made on inference.
--
-- SHAPE: one row per (tournament, lifecycle class, hour bucket), upserted with
-- running aggregates. Bucketing rather than one-row-per-mutation keeps this
-- bounded — a busy tournament produces 24 rows a day regardless of how many
-- mutations it serves — and an hour is fine granularity for sizing pools.
--
-- `max_elapsed_ms` and `max_record_bytes` are kept alongside the sums because
-- the tail is the interesting part: a tournament whose MEAN save is 8ms but
-- whose MAX is 900ms is a head-of-line-blocking problem that an average hides
-- completely. Single-threaded Node means one 900ms serialise stalls every other
-- tournament in the process for 900ms.
--
-- `lifecycle_class` is recorded, never acted on — see lifecycleClass.ts. Its
-- job here is to be compared against observed activity, so that "are the dates
-- on real records trustworthy enough to route on?" becomes a query rather than
-- an assumption.

CREATE TABLE IF NOT EXISTS tournament_load_profile (
  tournament_id     TEXT NOT NULL,
  bucket_start      TIMESTAMPTZ NOT NULL,     -- hour bucket (UTC)
  lifecycle_class   TEXT NOT NULL,            -- archive | construction | live | unknown
  mutation_count    BIGINT NOT NULL DEFAULT 0,
  method_count      BIGINT NOT NULL DEFAULT 0, -- factory methods across all mutations in the bucket
  total_elapsed_ms  BIGINT NOT NULL DEFAULT 0, -- summed; mean = total / mutation_count
  max_elapsed_ms    BIGINT NOT NULL DEFAULT 0,
  total_record_bytes BIGINT NOT NULL DEFAULT 0,
  max_record_bytes  BIGINT NOT NULL DEFAULT 0,
  fenced_count      BIGINT NOT NULL DEFAULT 0, -- saves rejected by the owner_epoch fence (migration 042)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, bucket_start, lifecycle_class)
);

-- Primary read pattern is "what did the last N hours look like across all
-- tournaments" (pool sizing, hot-tournament identification), which the PK
-- cannot serve because it leads with tournament_id.
CREATE INDEX IF NOT EXISTS idx_tournament_load_profile_bucket
  ON tournament_load_profile(bucket_start DESC);

-- Secondary: "which classes are actually generating load" — the query that
-- falsifies the lifecycle-date assumption.
CREATE INDEX IF NOT EXISTS idx_tournament_load_profile_class
  ON tournament_load_profile(lifecycle_class, bucket_start DESC);
