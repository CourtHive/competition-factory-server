/**
 * computeEffectiveConfig — merge ProviderConfigCaps and
 * ProviderConfigSettings into the effective ProviderConfigData
 * shape that TMX consumes.
 *
 * Merge rules (per the field-ownership matrix in
 * `Mentat/planning/TMX_PROVIDER_CONFIG_FEATURES.md`):
 *
 *   branding              caps owns (settings has no branding field)
 *   integrations          caps owns
 *   defaults              settings owns
 *   policies.scheduling/scoring/seedingPolicy
 *                         settings owns
 *   permissions.canX
 *     (booleans)          (caps[X] ?? defaultForX) AND (settings[X] ?? defaultForX)
 *   permissions.allowedX
 *     (arrays)            intersect(caps[X], settings[X])
 *                         empty caps array  → unrestricted (settings wins)
 *                         empty settings    → unrestricted within caps
 *   policies.allowedMatchUpFormats / allowedCategories
 *                         intersect(caps, settings)
 *
 * Most boolean permissions default to `true` (permissive). The
 * exceptions (default `false`) are listed in `PERMISSIONS_DEFAULT_FALSE`.
 */

import {
  ARRAY_PERMISSION_KEYS,
  BOOLEAN_PERMISSION_KEYS,
  PERMISSIONS_DEFAULT_FALSE,
  type AllowedCategory,
  type ProviderConfigCaps,
  type ProviderConfigData,
  type ProviderConfigSettings,
  type ProviderPermissions,
  type ProviderPolicyDefaults,
} from './provider-config.types';

export function computeEffectiveConfig(
  caps: ProviderConfigCaps = {},
  settings: ProviderConfigSettings = {},
): ProviderConfigData {
  return {
    branding: caps.branding,
    permissions: mergePermissions(caps.permissions, settings.permissions),
    policies: mergePolicies(caps.policies, settings.policies),
    defaults: settings.defaults,
    integrations: caps.integrations,
    // participantPrivacy is provider-owned (settings tier only). The
    // provisioner has no caps surface here — privacy is between the
    // provider and its participants. Default = false (privacy-first)
    // when absent.
    participantPrivacy: { cityState: settings.participantPrivacy?.cityState === true },
  };
}

function defaultForPermission(key: keyof ProviderPermissions): boolean {
  return !PERMISSIONS_DEFAULT_FALSE.has(key);
}

export function mergePermissions(
  caps: Partial<ProviderPermissions> = {},
  settings: Partial<ProviderPermissions> = {},
): ProviderPermissions {
  const out: ProviderPermissions = {};

  for (const key of BOOLEAN_PERMISSION_KEYS) {
    const def = defaultForPermission(key);
    const capValue = caps[key] ?? def;
    const settingValue = settings[key] ?? def;
    out[key] = capValue && settingValue;
  }

  for (const key of ARRAY_PERMISSION_KEYS) {
    const merged = intersectStringList(caps[key], settings[key]);
    if (merged !== undefined) out[key] = merged;
  }

  return out;
}

export function mergePolicies(
  caps: Partial<ProviderPolicyDefaults> = {},
  settings: Partial<ProviderPolicyDefaults> = {},
): ProviderPolicyDefaults {
  const out: ProviderPolicyDefaults = {
    schedulingPolicy: settings.schedulingPolicy,
    scoringPolicy: settings.scoringPolicy,
    seedingPolicy: settings.seedingPolicy,
  };

  const formats = intersectStringList(caps.allowedMatchUpFormats, settings.allowedMatchUpFormats);
  if (formats !== undefined) out.allowedMatchUpFormats = formats;

  const cats = intersectCategoryList(caps.allowedCategories, settings.allowedCategories);
  if (cats !== undefined) out.allowedCategories = cats;

  return out;
}

/**
 * Intersection rule for "allowed-X" string arrays:
 *   - both undefined           → undefined (no restriction)
 *   - one undefined or empty   → use the other (empty = unrestricted)
 *   - both non-empty           → array intersection
 *
 * Empty array is treated as "unrestricted" because that is how
 * existing TMX consumers interpret it (see
 * TMX/src/config/providerConfig.ts:172 — `allowedX: []` means
 * "all allowed"). This matches user expectation: leaving the
 * picker empty should not silently disable everything.
 */
function intersectStringList(a?: string[], b?: string[]): string[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined || a.length === 0) return b;
  if (b === undefined || b.length === 0) return a;
  const setB = new Set(b);
  return a.filter((item) => setB.has(item));
}

/** Categories intersect by `ageCategoryCode`. */
function intersectCategoryList(a?: AllowedCategory[], b?: AllowedCategory[]): AllowedCategory[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined || a.length === 0) return b;
  if (b === undefined || b.length === 0) return a;
  const codesB = new Set(b.map((c) => c.ageCategoryCode));
  return a.filter((c) => codesB.has(c.ageCategoryCode));
}
