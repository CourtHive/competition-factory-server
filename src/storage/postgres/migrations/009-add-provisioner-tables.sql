-- 009-add-provisioner-tables.sql
-- Provisioner entities for machine-to-machine API key auth, provider associations,
-- tournament ownership tracking, and SSO external identity mapping.

-- Provisioner entities (e.g. IONSport)
CREATE TABLE IF NOT EXISTS provisioners (
  provisioner_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  is_active      BOOLEAN DEFAULT true,
  config         JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provisioners_name ON provisioners(name);

-- Multiple API keys per provisioner for zero-downtime rotation
CREATE TABLE IF NOT EXISTS provisioner_api_keys (
  key_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provisioner_id UUID NOT NULL REFERENCES provisioners(provisioner_id) ON DELETE CASCADE,
  api_key_hash   TEXT NOT NULL,
  label          TEXT,
  is_active      BOOLEAN DEFAULT true,
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_provisioner_api_keys_provisioner ON provisioner_api_keys(provisioner_id);
CREATE INDEX IF NOT EXISTS idx_provisioner_api_keys_active ON provisioner_api_keys(api_key_hash) WHERE is_active = true;

-- Many-to-many: provisioners ↔ providers with relationship type
CREATE TABLE IF NOT EXISTS provisioner_providers (
  provisioner_id UUID NOT NULL REFERENCES provisioners(provisioner_id) ON DELETE CASCADE,
  provider_id    TEXT NOT NULL,
  relationship   TEXT NOT NULL DEFAULT 'owner',
  granted_by     UUID REFERENCES provisioners(provisioner_id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (provisioner_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_provisioner_providers_provider ON provisioner_providers(provider_id);

-- Lightweight tournament → provisioner ownership mapping for access control
CREATE TABLE IF NOT EXISTS tournament_provisioner (
  tournament_id    TEXT PRIMARY KEY,
  provisioner_id   UUID NOT NULL REFERENCES provisioners(provisioner_id),
  provider_id      TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_provisioner_prov ON tournament_provisioner(provisioner_id);
CREATE INDEX IF NOT EXISTS idx_tournament_provisioner_provider ON tournament_provisioner(provider_id);

-- SSO external identity mapping
CREATE TABLE IF NOT EXISTS sso_identities (
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sso_provider  TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (sso_provider, external_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sso_identities_user_provider ON sso_identities(user_id, sso_provider);

-- Add provider_config column to existing providers table
ALTER TABLE providers ADD COLUMN IF NOT EXISTS provider_config JSONB DEFAULT '{}';
