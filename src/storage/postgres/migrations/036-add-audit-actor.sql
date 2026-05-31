-- 036-add-audit-actor.sql
-- AFFECTS: admin
--
-- Generalises the audit log's "who did this" representation from a
-- single UUID column (user_id) to a polymorphic actor pair
-- (actor_type, actor_id). The original column was UUID-typed which
-- broke for provisioner-key and provider-key callers — the
-- middleware writes a prefixed string like
-- `provisioner:<uuid>` into req.user.userId, and the INSERT
-- threw `invalid input syntax for type uuid` every mint, every
-- save, every tournament generate via a provisioner key
-- (silent: callers fail-soft, but log churn was significant).
--
-- The new model:
--
--   actor_type ∈ { 'user', 'provisioner', 'provider', 'service' }
--   actor_id   TEXT — uuid for user/provisioner/provider, free-form
--                     identifier for service (e.g. 'score-relay').
--
-- Migration is additive; the legacy user_id column stays nullable and
-- new writes leave it null. Existing rows keep their user_id and have
-- NULL actor_*. A follow-on migration may backfill once enough rows
-- have been written under the new model to confirm the actor encoding.

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS actor_type TEXT,
  ADD COLUMN IF NOT EXISTS actor_id   TEXT;

-- Look up "all activity by this actor" — same pattern as the
-- existing idx_audit_log_user, but on the new pair.
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log (actor_type, actor_id, occurred_at DESC)
  WHERE actor_type IS NOT NULL;
