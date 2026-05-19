-- AFFECTS: admin
-- 024-add-policies.sql
-- Published delivery registry for policies served by CFS to consumers
-- (TMX, courthive-rankings, courthive-ingest). Distinct from
-- `provider_catalog_items` (migration 021), which is the authoring
-- workspace TMX's /policies page edits in place. A row here is an
-- immutable snapshot for a (provider_id, policy_type, name, version)
-- tuple — federation policy updates land as a new row with a bumped
-- version, never an in-place edit.
--
-- visibility tiers:
--   PROVIDER_PRIVATE — visible only to the owning providerId
--   SHARED_DEMO      — globally readable for the public demo catalog
--   TEMPLATE_REF     — globally readable, marked as a canonical template
--
-- provider_id is nullable so SHARED_DEMO and TEMPLATE_REF rows can be
-- platform-owned (no provider).
--
-- Soft-delete via deleted_at — keeps historical references valid for
-- ingest snapshots that pinned a (name, version) at scrape time.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS policies (
  policy_id     uuid PRIMARY KEY,
  provider_id   text REFERENCES providers(provider_id) ON DELETE CASCADE,
  policy_type   text NOT NULL,
  name          text NOT NULL,
  version       text NOT NULL DEFAULT '1.0.0',
  visibility    text NOT NULL CHECK (visibility IN ('PROVIDER_PRIVATE', 'SHARED_DEMO', 'TEMPLATE_REF')),
  definition    jsonb NOT NULL,
  metadata      jsonb,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  text,
  deleted_at    timestamptz
);

-- Active rows are unique per (provider, type, name, version); soft-deleted
-- rows are excluded from the uniqueness constraint so a republished version
-- can reuse the same tuple after delete.
CREATE UNIQUE INDEX IF NOT EXISTS policies_unique_active
  ON policies (COALESCE(provider_id, ''), policy_type, name, version)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS policies_provider
  ON policies (provider_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS policies_visibility
  ON policies (visibility)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS policies_type_name
  ON policies (policy_type, name)
  WHERE deleted_at IS NULL;
