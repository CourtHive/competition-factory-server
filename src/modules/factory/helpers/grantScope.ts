/**
 * Scoped-grant predicate — now owned by `@courthive/provider-config`.
 *
 * The server enforces scope and TMX shapes its UI to match, so two
 * implementations would drift and a drift means TMX offers a control this gate
 * then refuses. The shared package is the one artifact both repos import.
 *
 * Re-exported here rather than rewriting every import site, and because
 * `ScopeTarget` is the name the shared module uses for what this file called
 * `MutationTarget`.
 */
export {
  GRANT_CAPABILITY_ALL,
  SCOPE_KEYS,
  grantCoversCapability,
  grantCoversMethod,
  isEvaluableScope,
  isTargetInScope,
  isTournamentWide,
  isWithinWindow,
  requiredTargetFields,
  type GrantScope,
  type ScopeKey,
  type ScopeTarget,
  type ScopeTarget as MutationTarget,
} from '@courthive/provider-config';
