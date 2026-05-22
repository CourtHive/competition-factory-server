-- AFFECTS: end-users
-- Adds the `must_change_password` flag used by the admin-create-user flow.
-- When an administrator creates a user with an assigned (or generated)
-- password, the new row is written with `must_change_password = TRUE`.
-- The signIn path returns a short-lived limited-scope token + flag instead
-- of a full JWT; /auth/complete-first-login accepts that token + a new
-- password, clears the flag, and returns a full JWT.
--
-- Default FALSE so existing users are unaffected — they keep logging in
-- with their current credentials.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
