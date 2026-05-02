-- 020-add-provider-topologies.sql
-- Per-provider topology catalog for the admin-client Templates page.
-- Each row is a saved topology (bracket structure) authored by a
-- provider admin. Topology IDs are referenced by `allowedDrawTypes`
-- in `providerConfigSettings` so the Allowed Selections chip widget
-- can surface provider-defined draw structures alongside the factory
-- enum.
--
-- Per-provider only: there is no system-wide topology catalog. Builtin
-- topologies are read-only (provided by `standardTemplates` from
-- `courthive-components`) and don't need server storage.

CREATE TABLE IF NOT EXISTS provider_topologies (
  topology_id   TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  state         JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider_id, name)
);

CREATE INDEX IF NOT EXISTS idx_provider_topologies_provider ON provider_topologies(provider_id);
