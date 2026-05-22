-- AFFECTS: end-users
-- Splits the long-overdue separation between users.email (the LOGIN
-- identifier — historically often a non-email string like "alice" or
-- "pro-shop-1") and users.contact_email (the verified RFC 5322 address
-- mail is sent to). Password reset, account notifications, and any
-- future user-facing email flow targets contact_email — never email.
--
-- Backfill is conservative: copy `email` → `contact_email` only when
-- the login string is unambiguously email-shaped. Everyone else gets
-- NULL and is nagged into setting one via the admin-client banner.
-- `email_verified_at` stays NULL for all rows, including the backfilled
-- ones — users still need to click the verification link before the
-- address is trusted for outbound mail.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS contact_email     TEXT,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Functional unique-ish index for case-insensitive lookups (the verify
-- flow + the eventual forgot-password flow both look up by lower-cased
-- contact_email). Not UNIQUE because two users can legitimately share a
-- contact email (a family / shared mailbox) — the constraint that
-- matters at sign-in is users.email uniqueness, not contact_email.
CREATE INDEX IF NOT EXISTS idx_users_contact_email_lower
  ON users (LOWER(contact_email))
  WHERE contact_email IS NOT NULL;

-- Conservative backfill: only seed contact_email where the login email
-- is RFC-shaped. Local-part: word chars + . _ % + -. Domain: at least
-- one dot, TLD ≥ 2 letters. Case-insensitive (~*). Skips:
--   - non-email logins ('alice', 'pro-shop-1')
--   - malformed locals ('user@@example.com', 'user@')
--   - single-label hosts ('user@localhost')
-- Users matching this regex still need to verify; we just give them a
-- one-click pre-fill in the settings UI.
UPDATE users
   SET contact_email = email
 WHERE contact_email IS NULL
   AND email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$';
