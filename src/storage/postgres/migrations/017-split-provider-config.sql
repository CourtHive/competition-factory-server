-- 017-split-provider-config.sql
-- Two-tier provider config: split the legacy single `providerConfig` blob
-- in providers.data into `providerConfigCaps` (provisioner-owned) and
-- `providerConfigSettings` (provider-admin-owned). See
-- Mentat/planning/TMX_PROVIDER_CONFIG_FEATURES.md.
--
-- Migration semantics:
--   * If a provider has a legacy `providerConfig` field, treat it as caps
--     (provisioner-set) and start with empty settings.
--   * If a provider has neither key, set both to empty objects.
--   * If a provider already has `providerConfigCaps` (re-run / fresh
--     install), leave caps as-is and ensure settings exists.
--
-- Idempotent: re-running the migration is a no-op once both keys exist.
-- The legacy `providerConfig` key is removed; consumers should now read
-- `providerConfigCaps` and `providerConfigSettings`.

UPDATE providers
SET data = jsonb_set(
  jsonb_set(
    data - 'providerConfig',
    '{providerConfigCaps}',
    COALESCE(data->'providerConfigCaps', data->'providerConfig', '{}'::jsonb),
    true
  ),
  '{providerConfigSettings}',
  COALESCE(data->'providerConfigSettings', '{}'::jsonb),
  true
)
WHERE data ? 'providerConfig'
   OR NOT (data ? 'providerConfigCaps')
   OR NOT (data ? 'providerConfigSettings');
