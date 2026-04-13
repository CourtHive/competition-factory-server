-- 004-add-user-uuid.sql
-- Adds a UUID primary key to users. Email becomes a unique index (login key)
-- rather than the identity key, enabling future email mutability without FK remap.

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add the UUID column with a default
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT gen_random_uuid();

-- Backfill any existing rows that have NULL user_id
UPDATE users SET user_id = gen_random_uuid() WHERE user_id IS NULL;

-- Make it NOT NULL
ALTER TABLE users ALTER COLUMN user_id SET NOT NULL;

-- Swap PK: drop email PK, promote user_id to PK, add unique index on email.
-- The DO block handles the case where the constraint doesn't exist (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_pkey' AND table_name = 'users'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_pkey;
  END IF;
END
$$;

-- user_id becomes the PK (only if not already)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_pkey' AND table_name = 'users'
  ) THEN
    ALTER TABLE users ADD PRIMARY KEY (user_id);
  END IF;
END
$$;

-- Email remains the login key — must be unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
