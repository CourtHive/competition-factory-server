/**
 * Neutral CFS constant — the organisationId stamped on
 * `Participant.person.personOtherIds[]` when a TODS Participant is linked to
 * the canonical Person record produced by the registry. The literal value is
 * intentionally `'CANONICAL_PERSON'` — NOT `'courthive-persons'` — so factory +
 * TODS records stay neutral to which canonical registry produced the identifier
 * (USTA, ITA, HTS, CTS, any federation, or this one).
 *
 * Lives here (not in `account/auth/hiveid.constants`) so the STAY tournament-
 * admin surfaces (registrations, declarations) do NOT import from the account
 * tree that lifts out to the HiveID IdP — the Phase-3 re-parenting prerequisite
 * (Mentat/planning/ACCOUNT_SERVICE_BOUNDARY.md, ACCOUNT_MOVE_PHASE2_3_PLAN.md §2c).
 */
export const CANONICAL_PERSON = 'CANONICAL_PERSON';
