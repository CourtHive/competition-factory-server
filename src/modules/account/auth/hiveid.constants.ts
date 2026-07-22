// CANONICAL_PERSON moved to the neutral `src/common/constants/canonicalPerson`
// so the STAY tournament-admin surfaces (registrations, declarations) don't
// import from the account tree that lifts out to the IdP (Phase-3 re-parenting).
// Re-exported here for the hiveid MOVE-side callers that still reference it.
export { CANONICAL_PERSON } from 'src/common/constants/canonicalPerson';

/** Prefix on magic-link codes that yield a HiveID-audience session. */
export const HIVEID_MAGIC_LINK_PREFIX = 'hmlk_';
