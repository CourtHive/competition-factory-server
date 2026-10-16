-- 053-drop-pending-saves.sql
-- AFFECTS: admin
-- Drops `pending_saves`, the queue of an "async L2 validation" for records over a byte threshold.
--
-- ── WHY IT IS SAFE, MEASURED RATHER THAN ASSUMED ─────────────────────────────
--
-- Queried 2026-10-16, before writing this:
--
--   SELECT count(*) FROM pending_saves;   -- prod (courthive-nest, shared with dev): 0
--   SELECT count(*) FROM pending_saves;   -- Button: 0
--
-- The table never held a row. Oversized saves were written straight to `tournaments`, unvalidated, and the queue
-- insert after them either never ran or threw (a provider-key principal, `provider:<id>`, is not a UUID: 787 such
-- errors in Button's CFS log). Since #1046 every record is validated synchronously before it is written and nothing
-- is queued; this change removes the rest of the path: `save-status`, `internal/commit-save`, `commitSave`, the
-- audit-worker loop that polled this table, and the provider cleanup / archive / revive references to it.
-- Mentat/planning/CFS_LARGE_SAVES.md.

DROP TABLE IF EXISTS pending_saves;
