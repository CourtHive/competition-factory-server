-- 013-add-officiating-sanctioning.sql
-- JSONB document tables for officiating and sanctioning records.
-- Replaces LevelDB-backed officialRecord and sanctioningRecord namespaces.

CREATE TABLE IF NOT EXISTS official_records (
  official_record_id TEXT PRIMARY KEY,
  provider_id        TEXT,
  data               JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_official_records_provider ON official_records(provider_id);

CREATE TABLE IF NOT EXISTS sanctioning_records (
  sanctioning_id       TEXT PRIMARY KEY,
  applicant_provider_id TEXT,
  data                  JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sanctioning_records_provider ON sanctioning_records(applicant_provider_id);
