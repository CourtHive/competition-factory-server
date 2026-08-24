/**
 * Write-time validation for scoped grants.
 *
 * A grant the gate can never honour is worse than no grant: it reads as access
 * given, and the failure surfaces as a refusal on a Saturday morning rather
 * than at the moment somebody got it wrong. So everything the gate silently
 * treats as "not covered" is rejected here, loudly, at write time — an
 * unrecognized scope key (which `isTargetInScope` refuses forever), a permitted
 * -value list that is empty and therefore constrains nothing while looking like
 * a restriction, and a window that has already closed.
 *
 * These are pure functions on purpose: the interesting behaviour is the
 * decision, and a decision buried in a service method needs a database to test.
 */
import {
  BOOLEAN_PERMISSION_KEYS,
  GRANT_CAPABILITY_ALL,
  SCOPE_KEYS,
  isEvaluableScope,
} from '@courthive/provider-config';

import type { GrantScope } from '@courthive/provider-config';

const CAPABILITY_KEYS: ReadonlySet<string> = new Set<string>(BOOLEAN_PERMISSION_KEYS);
const SCOPE_KEY_SET: ReadonlySet<string> = new Set<string>(SCOPE_KEYS);

/**
 * A capability is a `ProviderPermissions` key, or `'*'` for a full grant
 * narrowed only by scope. Roles are presets that expand to these — the column
 * never holds a role name.
 */
export function validateCapability(capability: unknown): string | null {
  if (capability === GRANT_CAPABILITY_ALL) return null;
  if (typeof capability !== 'string' || !capability.trim()) return 'capability is required';
  if (!CAPABILITY_KEYS.has(capability)) {
    return `unknown capability "${capability}" — expected "${GRANT_CAPABILITY_ALL}" or a permission key such as canEnterScores`;
  }
  return null;
}

/**
 * Scope keys are the factory's `filterMatchUps` vocabulary. An unrecognized key
 * is refused rather than ignored, matching the gate: the safe reading of an
 * unintelligible restriction is not to wave the mutation through, and a grant
 * carrying one would be inert forever.
 */
export function validateScope(scope: unknown): string | null {
  if (scope === undefined || scope === null) return null;
  if (typeof scope !== 'object' || Array.isArray(scope)) return 'scope must be an object';

  if (!isEvaluableScope(scope as GrantScope)) {
    const unknown = Object.keys(scope).filter((key) => !SCOPE_KEY_SET.has(key));
    const label = unknown.length === 1 ? 'key' : 'keys';
    return `unknown scope ${label} ${unknown.map((key) => `"${key}"`).join(', ')} — expected any of ${SCOPE_KEYS.join(', ')}`;
  }

  for (const [key, allowed] of Object.entries(scope)) {
    if (!Array.isArray(allowed)) return `scope.${key} must be an array of ids`;
    // `isTargetInScope` skips an empty list, so this stores as a restriction
    // and behaves as none. Omitting the key says the same thing honestly.
    if (!allowed.length) return `scope.${key} is empty — an empty list constrains nothing, so omit the key instead`;
    if (allowed.some((value) => typeof value !== 'string' || !value.trim())) {
      return `scope.${key} must contain non-empty id strings`;
    }
  }
  return null;
}

/** `null` when absent, a number of ms when parseable, `NaN` when it is neither. */
function toInstant(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string') return Number.NaN;
  return Date.parse(value);
}

/**
 * Delivery roles are shift-based and handed over, so the window is the part an
 * operator most often gets wrong. A grant that expired before it was written is
 * refused rather than stored: it would look like access and behave like none.
 */
export function validateWindow(notBefore: unknown, notAfter: unknown, now: Date = new Date()): string | null {
  const before = toInstant(notBefore);
  const after = toInstant(notAfter);

  if (Number.isNaN(before)) return 'notBefore is not a valid date';
  if (Number.isNaN(after)) return 'notAfter is not a valid date';
  if (before !== null && after !== null && after <= before) return 'notAfter must be later than notBefore';
  if (after !== null && after <= now.getTime()) {
    return 'notAfter is already in the past — the grant would never be live';
  }
  return null;
}

/**
 * Postgres types `grant_id` as UUID, so a malformed id reaches the driver as a
 * syntax error and surfaces as a 500. A shape check turns that into the 'not
 * found' it actually is.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}
