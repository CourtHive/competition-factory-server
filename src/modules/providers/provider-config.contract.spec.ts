/**
 * Contract test — server canonical key lists in
 * `provider-config.types.ts` must match the agreed canonical set.
 *
 * The TMX side has a parallel contract test at
 * `TMX/src/config/providerConfig.contract.test.ts` with the same
 * CANONICAL_* lists. Both sides must be updated together when a
 * permission key is added or removed.
 *
 * When promoting types to a shared `@courthive/provider-config`
 * package (TASKS.md item — revisit when scaffolding more
 * capabilities), this test becomes redundant and can be deleted.
 */

import {
  ARRAY_PERMISSION_KEYS,
  BOOLEAN_PERMISSION_KEYS,
  PERMISSIONS_DEFAULT_FALSE,
} from './provider-config.types';

const CANONICAL_BOOLEAN_PERMISSION_KEYS = [
  'canCreateCompetitors',
  'canCreateOfficials',
  'canDeleteParticipants',
  'canImportParticipants',
  'canEditParticipantDetails',
  'canCreateEvents',
  'canDeleteEvents',
  'canModifyEventFormat',
  'canCreateDraws',
  'canDeleteDraws',
  'canUseDraftPositioning',
  'canUseManualPositioning',
  'canModifySchedule',
  'canUseBulkScheduling',
  'canCreateVenues',
  'canDeleteVenues',
  'canModifyCourtAvailability',
  'canEnterScores',
  'canModifyCompletedScores',
  'canPublish',
  'canUnpublish',
  'canModifyTournamentDetails',
  'canModifyPolicies',
  'canAccessProviderAdmin',
] as const;

const CANONICAL_ARRAY_PERMISSION_KEYS = [
  'allowedDrawTypes',
  'allowedCreationMethods',
  'allowedScoringApproaches',
] as const;

const CANONICAL_PERMISSIONS_DEFAULT_FALSE = ['canModifyCompletedScores', 'canAccessProviderAdmin'] as const;

describe('provider-config.types contract — server canonical lists match agreed set', () => {
  it('BOOLEAN_PERMISSION_KEYS matches canonical (set equality)', () => {
    const serverSet = new Set(BOOLEAN_PERMISSION_KEYS);
    const canonicalSet = new Set<string>(CANONICAL_BOOLEAN_PERMISSION_KEYS);
    expect(serverSet.size).toBe(canonicalSet.size);
    for (const key of canonicalSet) expect(serverSet.has(key as any)).toBe(true);
  });

  it('ARRAY_PERMISSION_KEYS matches canonical (set equality)', () => {
    const serverSet = new Set(ARRAY_PERMISSION_KEYS);
    const canonicalSet = new Set<string>(CANONICAL_ARRAY_PERMISSION_KEYS);
    expect(serverSet.size).toBe(canonicalSet.size);
    for (const key of canonicalSet) expect(serverSet.has(key as any)).toBe(true);
  });

  it('PERMISSIONS_DEFAULT_FALSE matches canonical', () => {
    expect(PERMISSIONS_DEFAULT_FALSE.size).toBe(CANONICAL_PERMISSIONS_DEFAULT_FALSE.length);
    for (const key of CANONICAL_PERMISSIONS_DEFAULT_FALSE) {
      expect(PERMISSIONS_DEFAULT_FALSE.has(key)).toBe(true);
    }
  });

  it('boolean and array permission key sets are disjoint', () => {
    const boolSet = new Set<string>(BOOLEAN_PERMISSION_KEYS);
    for (const arrKey of ARRAY_PERMISSION_KEYS) {
      expect(boolSet.has(arrKey)).toBe(false);
    }
  });

  it('every default-false key is in the boolean permission set', () => {
    const boolSet = new Set<string>(BOOLEAN_PERMISSION_KEYS);
    for (const key of PERMISSIONS_DEFAULT_FALSE) {
      expect(boolSet.has(key)).toBe(true);
    }
  });
});
