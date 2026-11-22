-- AFFECTS: end-users
-- Feedback from anyone signed in (CA, 2026-11-22): a case is provider-scoped when a provider is selected and
-- platform-scoped otherwise, and is a bug report or a suggestion. Existing rows are provider-scoped bug reports.
ALTER TABLE support_cases ALTER COLUMN provider_id DROP NOT NULL;
ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'provider'
  CHECK (scope IN ('provider', 'platform'));
ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'bug'
  CHECK (kind IN ('bug', 'suggestion'));
-- A provider-scoped case names its provider; a platform case names none.
ALTER TABLE support_cases DROP CONSTRAINT IF EXISTS support_cases_scope_provider;
ALTER TABLE support_cases ADD CONSTRAINT support_cases_scope_provider
  CHECK ((scope = 'provider') = (provider_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS support_cases_platform_time ON support_cases(submitted_at) WHERE scope = 'platform';
