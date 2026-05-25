-- 031-add-refresh-tokens.sql
-- AFFECTS: admin
-- Refresh-token store for the access/refresh JWT session model.
--
-- Access tokens stay short-lived (4h) JWTs verified statelessly by AuthGuard.
-- Refresh tokens are long-lived (30d) opaque secrets, stored here as SHA-256
-- hashes (never plaintext) and rotated on every use. A rotation chain shares a
-- `family_id`; presenting an already-rotated (revoked) token is treated as
-- theft and revokes the whole family. Analogous to auth_codes (also `admin`):
-- session infrastructure, not end-user tournament data. Purely additive — a
-- new table, so it cannot break any existing flow.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  email        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  family_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID,
  user_agent   TEXT
);

-- Hot path: look up the presented token by its hash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
-- Reuse-detection / breach response: revoke an entire rotation family.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
-- Logout-all and password-change revocation by user.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
-- Housekeeping sweep of expired rows.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
