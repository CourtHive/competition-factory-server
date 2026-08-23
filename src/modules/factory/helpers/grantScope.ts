/**
 * Does a mutation fall inside a grant's scope?
 *
 * A permission without a scope answers the wrong question. `canEnterScores` is a
 * global boolean: it cannot express that a volunteer may score on Court 7 but
 * not the final on Centre. This module supplies the missing dimension.
 *
 * ## The vocabulary is borrowed, not invented
 *
 * Scope keys are the factory's existing `filterMatchUps` parameters — the same
 * names, meaning the same things. A second predicate language would drift from
 * the first.
 *
 * ## Empty scope means tournament-wide
 *
 * `{}` is the shipped behavior, so a grant with no scope is exactly as
 * permissive as today. That makes the table additive: nothing changes until
 * someone writes a scoped row.
 *
 * ## Unknown keys are a DENY, not an ignore
 *
 * A scope carrying a key this code does not understand cannot be evaluated, and
 * the safe reading of "I don't know what this restriction means" is to refuse —
 * not to wave the mutation through. That is architectural standard A3 applied to
 * data rather than config: missing understanding must fail closed.
 */

/** Scope dimensions this evaluator understands. Closed by design. */
export const SCOPE_KEYS = [
  'eventIds',
  'drawIds',
  'structureIds',
  'venueIds',
  'courtIds',
  'scheduledDates',
  'matchUpIds',
] as const;

export type ScopeKey = (typeof SCOPE_KEYS)[number];
export type GrantScope = Partial<Record<ScopeKey, string[]>>;

/** Attributes of the thing a mutation targets, resolved by the caller. */
export type MutationTarget = Partial<Record<ScopeKey, string | undefined>>;

const SCOPE_KEY_SET: ReadonlySet<string> = new Set(SCOPE_KEYS);

/** Is every key in this scope one we can actually evaluate? */
export function isEvaluableScope(scope: GrantScope | undefined): boolean {
  if (!scope) return true;
  return Object.keys(scope).every((key) => SCOPE_KEY_SET.has(key));
}

export function isTournamentWide(scope: GrantScope | undefined): boolean {
  return !scope || Object.keys(scope).length === 0;
}

/**
 * Is the grant live right now?
 *
 * Delivery roles are shift-based and handed over; a grant that outlives its
 * shift is the same class of defect as one that was never scoped.
 */
export function isWithinWindow(
  grant: { notBefore?: string | Date | null; notAfter?: string | Date | null },
  now: Date = new Date(),
): boolean {
  if (grant.notBefore && new Date(grant.notBefore) > now) return false;
  if (grant.notAfter && new Date(grant.notAfter) < now) return false;
  return true;
}

/**
 * Does `target` fall inside `scope`?
 *
 * Every declared dimension must match (AND across keys, OR within a key). A
 * dimension the target cannot answer — a scope naming `courtIds` against a
 * mutation whose matchUp has no court — is a **deny**: an unschedulable matchUp
 * is not on Court 7, so a Court-7 grant does not cover it.
 */
export function isTargetInScope(scope: GrantScope | undefined, target: MutationTarget): boolean {
  if (isTournamentWide(scope)) return true;
  if (!isEvaluableScope(scope)) return false;

  for (const [key, allowed] of Object.entries(scope as Record<string, string[]>)) {
    if (!Array.isArray(allowed) || !allowed.length) continue; // empty list = unrestricted on this axis
    const value = target[key as ScopeKey];
    if (!value) return false; // target cannot answer this dimension → not covered
    if (!allowed.includes(value)) return false;
  }
  return true;
}

/** Which dimensions a scope constrains — lets the caller resolve only what it must. */
export function requiredTargetKeys(scope: GrantScope | undefined): ScopeKey[] {
  if (isTournamentWide(scope)) return [];
  return Object.entries(scope as Record<string, string[]>)
    .filter(([key, allowed]) => SCOPE_KEY_SET.has(key) && Array.isArray(allowed) && allowed.length > 0)
    .map(([key]) => key as ScopeKey);
}
