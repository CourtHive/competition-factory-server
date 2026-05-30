/**
 * CFS-side organisation key stamped on `Participant.person.personOtherIds[]`
 * when linking a TODS Participant to the canonical Person record produced
 * by the registry. The literal value is intentionally `'CANONICAL_PERSON'`
 * — NOT `'courthive-persons'` — so factory + TODS records stay neutral to
 * which canonical registry produced the identifier (USTA, ITA, HTS, CTS,
 * any federation, or this one).
 *
 * Consumed by the PR-J claim handler (courthive-public) via the
 * `addPersonOtherId` factory mutation (PR-K).
 */
export const CANONICAL_PERSON = 'CANONICAL_PERSON';

/** Prefix on magic-link codes that yield a HiveID-audience session. */
export const HIVEID_MAGIC_LINK_PREFIX = 'hmlk_';
