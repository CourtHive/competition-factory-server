-- 005-add-user-providers.sql
-- Join table for multi-provider user associations.
-- A user can have different roles at different providers using the same email.

CREATE TABLE IF NOT EXISTS user_providers (
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  provider_role TEXT NOT NULL DEFAULT 'DIRECTOR',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_user_providers_user ON user_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_providers_provider ON user_providers(provider_id);
