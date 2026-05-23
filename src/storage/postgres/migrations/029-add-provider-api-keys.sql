-- 029-add-provider-api-keys.sql
-- Provider-scoped API keys for direct provider-to-server integration.
--
-- Distinct from provisioner_api_keys (migration 009): a provider key
-- authenticates as a single provider and grants access only to that
-- provider's data. Used by partner organisations who don't need or want
-- a provisioner-level wrapper. Key prefix: `pkey_live_`.

CREATE TABLE IF NOT EXISTS provider_api_keys (
  key_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    TEXT NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  api_key_hash   TEXT NOT NULL,
  label          TEXT,
  is_active      BOOLEAN DEFAULT true,
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_provider_api_keys_provider ON provider_api_keys(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_api_keys_active ON provider_api_keys(api_key_hash) WHERE is_active = true;
