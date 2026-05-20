-- Per-user last-selected provider for multi-provider session context.
-- See Mentat/planning/MULTI_PROVIDER_SESSION_CONTEXT.md.
--
-- Users with N>1 user_providers associations need to pick one as the
-- active session context (drives calendar filtering + mutation stamping).
-- This column persists that choice across browsers / devices. TMX writes
-- via PATCH /auth/me/last-selected-provider; TMX reads via the signIn
-- response (which embeds lastSelectedProviderId alongside the new
-- providerAssociations[] field).
--
-- Backfill seeds existing users from the legacy users.provider_id so
-- everybody's first post-deploy login resolves to the provider they
-- were already implicitly using — no UX surprise. The legacy column
-- is slated for removal in Phase 5 of the multi-provider plan; this
-- column survives that.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_selected_provider_id TEXT;

UPDATE users
   SET last_selected_provider_id = provider_id
 WHERE last_selected_provider_id IS NULL
   AND provider_id IS NOT NULL;
