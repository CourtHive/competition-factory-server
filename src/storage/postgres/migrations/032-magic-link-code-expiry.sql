-- 032-magic-link-code-expiry.sql
-- AFFECTS: admin
-- Magic-link login codes must be short-lived and single-use. The access_codes
-- table (migration 001) stored only (code, email) with no expiry. Add an
-- expiry column so codes can be time-boxed; the consume path deletes the row
-- atomically (single-use). Additive column on an auth-infrastructure table —
-- no end-user tournament data touched.

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Lets a housekeeping sweep drop expired codes.
CREATE INDEX IF NOT EXISTS idx_access_codes_expires ON access_codes(expires_at);
