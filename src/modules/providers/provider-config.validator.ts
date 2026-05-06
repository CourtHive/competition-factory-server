/**
 * Provider config validators — runtime checks for caps and settings
 * writes. Returns a list of `ValidationIssue` per invalid field so
 * the admin-client UI can surface errors inline.
 *
 * Two validators:
 *   - `validateCaps(caps)`            structural check on caps writes
 *   - `validateSettings(settings, caps)` structural + caps-respect
 *
 * Both are pure functions; throw nothing, return issues. Caller
 * decides whether issues are a hard reject (HTTP 400) or
 * informational warnings.
 *
 * See `Mentat/planning/TMX_PROVIDER_CONFIG_FEATURES.md` for the
 * field-ownership matrix and the "exceeds cap" semantics.
 */

import {
  ARRAY_PERMISSION_KEYS,
  BOOLEAN_PERMISSION_KEYS,
  type ArrayPermissionKey,
  type BooleanPermissionKey,
  type ProviderConfigCaps,
  type ProviderConfigSettings,
} from './provider-config.types';

export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. "permissions.allowedDrawTypes" */
  path: string;
  /** Machine-readable issue code */
  code: ValidationIssueCode;
  /** Human-readable explanation */
  message: string;
  /** For exceedsCap, the disallowed values */
  disallowedValues?: string[];
}

export type ValidationIssueCode =
  | 'unknownField'
  | 'wrongType'
  | 'exceedsCap';

// ── Allowed top-level keys ──

const CAPS_TOP_LEVEL_KEYS = new Set(['branding', 'permissions', 'policies', 'integrations']);
const SETTINGS_TOP_LEVEL_KEYS = new Set(['permissions', 'policies', 'defaults', 'participantPrivacy']);
const PARTICIPANT_PRIVACY_KEYS = new Set(['cityState']);

const BRANDING_KEYS = new Set([
  'navbarLogoUrl',
  'navbarLogoAlt',
  'navbarLogoHeight',
  'splashLogoUrl',
  'appName',
  'accentColor',
]);

const CAPS_PERMISSION_KEY_SET = new Set<string>([...BOOLEAN_PERMISSION_KEYS, ...ARRAY_PERMISSION_KEYS]);
const SETTINGS_PERMISSION_KEY_SET = CAPS_PERMISSION_KEY_SET; // Settings can write the same permission keys

const CAPS_POLICY_KEYS = new Set(['allowedMatchUpFormats', 'allowedCategories']);
const SETTINGS_POLICY_KEYS = new Set([
  'schedulingPolicy',
  'scoringPolicy',
  'seedingPolicy',
  'allowedMatchUpFormats',
  'allowedCategories',
]);

const SETTINGS_DEFAULTS_KEYS = new Set([
  'defaultEventType',
  'defaultDrawType',
  'defaultCreationMethod',
  'defaultGender',
]);

const INTEGRATIONS_ALLOWED_KEYS = new Set(['ssoProvider']);

// ── Caps validator ──

export function validateCaps(caps: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(caps)) {
    issues.push({ path: '', code: 'wrongType', message: 'caps must be an object' });
    return issues;
  }

  for (const key of Object.keys(caps)) {
    if (!CAPS_TOP_LEVEL_KEYS.has(key)) {
      issues.push({
        path: key,
        code: 'unknownField',
        message: `unknown caps top-level key "${key}"; expected one of branding/permissions/policies/integrations`,
      });
    }
  }

  validateBranding(caps.branding, 'branding', issues);
  validateCapsPermissions(caps.permissions, 'permissions', issues);
  validateCapsPolicies(caps.policies, 'policies', issues);
  validateIntegrations(caps.integrations, 'integrations', issues);

  return issues;
}

// ── Settings validator (with caps-respect) ──

export function validateSettings(settings: unknown, caps: ProviderConfigCaps = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(settings)) {
    issues.push({ path: '', code: 'wrongType', message: 'settings must be an object' });
    return issues;
  }

  for (const key of Object.keys(settings)) {
    if (!SETTINGS_TOP_LEVEL_KEYS.has(key)) {
      issues.push({
        path: key,
        code: 'unknownField',
        message: `unknown settings top-level key "${key}"; expected one of permissions/policies/defaults`,
      });
    }
  }

  validateSettingsPermissions(settings.permissions, caps.permissions, 'permissions', issues);
  validateSettingsPolicies(settings.policies, caps.policies, 'policies', issues);
  validateDefaults(settings.defaults, 'defaults', issues);
  validateParticipantPrivacy(settings.participantPrivacy, 'participantPrivacy', issues);

  return issues;
}

// ── Participant privacy (settings tier only) ──

function validateParticipantPrivacy(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!PARTICIPANT_PRIVACY_KEYS.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        code: 'unknownField',
        message: `unknown participantPrivacy key "${key}"`,
      });
      continue;
    }
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined && typeof v !== 'boolean') {
      issues.push({
        path: `${path}.${key}`,
        code: 'wrongType',
        message: `${path}.${key} must be a boolean`,
      });
    }
  }
}

// ── Branding ──

function validateBranding(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!BRANDING_KEYS.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknownField', message: `unknown branding key "${key}"` });
      continue;
    }
    const v = value[key];
    if (key === 'navbarLogoHeight') {
      if (typeof v !== 'number') {
        issues.push({ path: `${path}.${key}`, code: 'wrongType', message: `${key} must be a number` });
      }
    } else if (typeof v !== 'string') {
      issues.push({ path: `${path}.${key}`, code: 'wrongType', message: `${key} must be a string` });
    }
  }
}

// ── Permissions: caps ──

function validateCapsPermissions(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!CAPS_PERMISSION_KEY_SET.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknownField', message: `unknown permission key "${key}"` });
      continue;
    }
    validatePermissionShape(key, value[key], path, issues);
  }
}

function validatePermissionShape(key: string, v: unknown, parentPath: string, issues: ValidationIssue[]): void {
  if ((ARRAY_PERMISSION_KEYS as ReadonlyArray<string>).includes(key)) {
    if (!isStringArray(v)) {
      issues.push({
        path: `${parentPath}.${key}`,
        code: 'wrongType',
        message: `${key} must be an array of strings`,
      });
    }
  } else if (typeof v !== 'boolean') {
    issues.push({
      path: `${parentPath}.${key}`,
      code: 'wrongType',
      message: `${key} must be a boolean`,
    });
  }
}

// ── Permissions: settings (with caps-respect) ──

function validateSettingsPermissions(
  settingsPerms: unknown,
  capsPerms: ProviderConfigCaps['permissions'] = {},
  path: string,
  issues: ValidationIssue[],
): void {
  if (settingsPerms === undefined) return;
  if (!isPlainObject(settingsPerms)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }

  for (const key of Object.keys(settingsPerms)) {
    if (!SETTINGS_PERMISSION_KEY_SET.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknownField', message: `unknown permission key "${key}"` });
      continue;
    }
    const v = settingsPerms[key];
    validatePermissionShape(key, v, path, issues);

    if ((ARRAY_PERMISSION_KEYS as ReadonlyArray<string>).includes(key)) {
      checkArrayCap(key as ArrayPermissionKey, v, capsPerms, path, issues);
    } else {
      checkBooleanCap(key as BooleanPermissionKey, v, capsPerms, path, issues);
    }
  }
}

function checkBooleanCap(
  key: BooleanPermissionKey,
  value: unknown,
  capsPerms: ProviderConfigCaps['permissions'] = {},
  parentPath: string,
  issues: ValidationIssue[],
): void {
  // Settings cannot upgrade `false` cap to `true`. If caps explicitly
  // forbid (cap = false) and settings tries to enable (value = true),
  // that's a violation.
  if (capsPerms[key] === false && value === true) {
    issues.push({
      path: `${parentPath}.${key}`,
      code: 'exceedsCap',
      message: `${key} cannot be enabled — provisioner cap forbids it`,
    });
  }
}

function checkArrayCap(
  key: ArrayPermissionKey,
  value: unknown,
  capsPerms: ProviderConfigCaps['permissions'] = {},
  parentPath: string,
  issues: ValidationIssue[],
): void {
  // Settings cannot include values outside the caps universe.
  // Caps undefined or empty = unrestricted, so any settings value passes.
  const capsUniverse = capsPerms[key];
  if (capsUniverse === undefined || capsUniverse.length === 0) return;
  if (!isStringArray(value)) return; // already reported as wrongType
  const allowed = new Set(capsUniverse);
  const disallowed = value.filter((item) => !allowed.has(item));
  if (disallowed.length > 0) {
    issues.push({
      path: `${parentPath}.${key}`,
      code: 'exceedsCap',
      message: `${key} contains values outside the provisioner-allowed universe`,
      disallowedValues: disallowed,
    });
  }
}

// ── Policies: caps ──

function validateCapsPolicies(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!CAPS_POLICY_KEYS.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknownField', message: `unknown caps policy key "${key}"` });
      continue;
    }
    if (key === 'allowedMatchUpFormats') {
      if (!isStringArray(value[key])) {
        issues.push({
          path: `${path}.${key}`,
          code: 'wrongType',
          message: `${key} must be an array of strings`,
        });
      }
    } else if (key === 'allowedCategories') {
      if (!isCategoryArray(value[key])) {
        issues.push({
          path: `${path}.${key}`,
          code: 'wrongType',
          message: `${key} must be an array of { ageCategoryCode, categoryName? } objects`,
        });
      }
    }
  }
}

// ── Policies: settings (with caps-respect on intersect-able fields) ──

function validateSettingsPolicies(
  settingsPolicies: unknown,
  capsPolicies: ProviderConfigCaps['policies'] = {},
  path: string,
  issues: ValidationIssue[],
): void {
  if (settingsPolicies === undefined) return;
  if (!isPlainObject(settingsPolicies)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }

  for (const key of Object.keys(settingsPolicies)) {
    if (!SETTINGS_POLICY_KEYS.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknownField', message: `unknown policy key "${key}"` });
      continue;
    }
    const v = settingsPolicies[key];
    if (key === 'allowedMatchUpFormats') {
      if (!isStringArray(v)) {
        issues.push({
          path: `${path}.${key}`,
          code: 'wrongType',
          message: `${key} must be an array of strings`,
        });
        continue;
      }
      const universe = capsPolicies.allowedMatchUpFormats;
      if (universe && universe.length > 0) {
        const allowed = new Set(universe);
        const disallowed = v.filter((item) => !allowed.has(item));
        if (disallowed.length > 0) {
          issues.push({
            path: `${path}.${key}`,
            code: 'exceedsCap',
            message: `${key} contains formats outside the provisioner-allowed universe`,
            disallowedValues: disallowed,
          });
        }
      }
    } else if (key === 'allowedCategories') {
      if (!isCategoryArray(v)) {
        issues.push({
          path: `${path}.${key}`,
          code: 'wrongType',
          message: `${key} must be an array of { ageCategoryCode, categoryName? } objects`,
        });
        continue;
      }
      const universe = capsPolicies.allowedCategories;
      if (universe && universe.length > 0) {
        const allowedCodes = new Set(universe.map((c) => c.ageCategoryCode));
        const disallowed = v.filter((c) => !allowedCodes.has(c.ageCategoryCode)).map((c) => c.ageCategoryCode);
        if (disallowed.length > 0) {
          issues.push({
            path: `${path}.${key}`,
            code: 'exceedsCap',
            message: `${key} contains categories outside the provisioner-allowed universe`,
            disallowedValues: disallowed,
          });
        }
      }
    }
    // schedulingPolicy / scoringPolicy / seedingPolicy are settings-only;
    // no caps to compare against, no shape constraint imposed here (they
    // are factory-shaped policy objects validated downstream by the engine).
  }
}

// ── Defaults ──

function validateDefaults(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!SETTINGS_DEFAULTS_KEYS.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknownField', message: `unknown default key "${key}"` });
      continue;
    }
    if (typeof value[key] !== 'string') {
      issues.push({ path: `${path}.${key}`, code: 'wrongType', message: `${key} must be a string` });
    }
  }
}

// ── Integrations ──

function validateIntegrations(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'wrongType', message: `${path} must be an object` });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!INTEGRATIONS_ALLOWED_KEYS.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        code: 'unknownField',
        message: `unknown integrations key "${key}"`,
      });
      continue;
    }
    if (typeof value[key] !== 'string') {
      issues.push({ path: `${path}.${key}`, code: 'wrongType', message: `${key} must be a string` });
    }
  }
}

// ── Helpers ──

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isCategoryArray(v: unknown): v is Array<{ ageCategoryCode: string; categoryName?: string }> {
  if (!Array.isArray(v)) return false;
  return v.every(
    (c) =>
      isPlainObject(c) &&
      typeof c.ageCategoryCode === 'string' &&
      (c.categoryName === undefined || typeof c.categoryName === 'string'),
  );
}

// Re-export for convenience
export type { ProviderConfigCaps, ProviderConfigSettings };
