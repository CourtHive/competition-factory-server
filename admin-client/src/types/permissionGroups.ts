/**
 * UI grouping for the provider-config permission editor. Pure presentation
 * concern — the canonical key universe lives in `@courthive/provider-config`
 * (BOOLEAN_PERMISSION_KEYS / ARRAY_PERMISSION_KEYS); this file just orders
 * those keys into the labelled sections the editor renders.
 */
import type { ProviderPermissions } from '@courthive/provider-config';

export interface PermissionGroup {
  label: string;
  keys: ReadonlyArray<keyof ProviderPermissions>;
}

export const PERMISSION_GROUPS: ReadonlyArray<PermissionGroup> = [
  {
    label: 'Participants',
    keys: [
      'canCreateCompetitors',
      'canCreateOfficials',
      'canDeleteParticipants',
      'canImportParticipants',
      'canEditParticipantDetails',
    ],
  },
  {
    label: 'Events',
    keys: ['canCreateEvents', 'canDeleteEvents', 'canModifyEventFormat'],
  },
  {
    label: 'Draws',
    keys: ['canCreateDraws', 'canDeleteDraws', 'canUseDraftPositioning', 'canUseManualPositioning'],
  },
  {
    label: 'Scheduling',
    keys: ['canModifySchedule', 'canUseBulkScheduling'],
  },
  {
    label: 'Venues',
    keys: ['canCreateVenues', 'canDeleteVenues', 'canModifyCourtAvailability'],
  },
  {
    label: 'Scoring',
    keys: ['canEnterScores', 'canModifyCompletedScores'],
  },
  {
    label: 'Publishing',
    keys: ['canPublish', 'canUnpublish'],
  },
  {
    label: 'Admin',
    keys: ['canModifyTournamentDetails', 'canModifyPolicies', 'canAccessProviderAdmin'],
  },
];
