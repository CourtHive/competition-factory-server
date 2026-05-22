-- AFFECTS: admin
-- Tracks archived providers so the backend revive-provider.mjs script can
-- locate the export directory and verify manifest integrity. Archive is
-- a one-way trip from the live DB: providers + all soft-FK rows are
-- exported to `shared/archives/<abbr>-<UTC-ts>/`, then deleted from the
-- live tables. This row is the durable pointer back to that export.
--
-- AFFECTS=admin: this is a control-plane bookkeeping table. End-user
-- data paths (tournaments, calendars, scoring) never read or write here.
-- The archive *itself* is destructive to end-user data, but that's the
-- archive operation's mutation, not this migration's.

CREATE TABLE IF NOT EXISTS provider_archives (
  archive_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       TEXT NOT NULL,
  provider_abbr     TEXT NOT NULL,
  provider_name     TEXT NOT NULL,
  archive_path      TEXT NOT NULL,
  manifest_sha256   TEXT NOT NULL,
  tournament_count  INT NOT NULL DEFAULT 0,
  user_assoc_count  INT NOT NULL DEFAULT 0,
  archived_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by       UUID,           -- users.user_id of the admin who archived. Nullable: super-admin
                                    -- imports + future automation may not have a userId in context.
  revived_at        TIMESTAMPTZ     -- Stamped by revive-provider.mjs on a successful restore.
                                    -- NULL while the archive is still the canonical state.
);

-- Lookup by provider_id when an operator wants to find "is there an
-- archive of <id>" — the revive script and the admin UI both query this.
CREATE INDEX IF NOT EXISTS idx_provider_archives_provider_id
  ON provider_archives(provider_id);

-- Listing pages sort by archived_at DESC.
CREATE INDEX IF NOT EXISTS idx_provider_archives_archived_at
  ON provider_archives(archived_at DESC);
