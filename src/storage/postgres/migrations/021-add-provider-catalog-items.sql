-- 021-add-provider-catalog-items.sql
-- Per-provider catalog items shared across the Templates page (compositions,
-- tieFormats) and the Policies page (policies). Topologies stay in their
-- own table (`provider_topologies`, migration 020) since they shipped first
-- and consolidating would require a data move; new types use this generic
-- table to avoid copy-pasting near-identical storage classes per type.
--
-- `metadata` is reserved for type-specific fields the editor components
-- need at the catalog-item level — for policies that's `policyType`
-- (matches the `PolicyCatalogItem` shape from courthive-components); for
-- compositions / tieFormats it's typically empty.

CREATE TABLE IF NOT EXISTS provider_catalog_items (
  catalog_id    TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  catalog_type  TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  data          JSONB NOT NULL,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider_id, catalog_type, name)
);

CREATE INDEX IF NOT EXISTS idx_provider_catalog_items_lookup
  ON provider_catalog_items(provider_id, catalog_type);
