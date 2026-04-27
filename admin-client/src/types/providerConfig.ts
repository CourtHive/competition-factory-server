/**
 * Admin-client mirror of the canonical provider-config types living at
 * `competition-factory-server/src/modules/providers/provider-config.types.ts`.
 *
 * Same-repo, but admin-client's tsconfig has its own `baseUrl: src/`,
 * so direct imports across the boundary aren't ergonomic. The KEYS
 * arrays here must stay in lockstep with the server canonical lists;
 * a contract test in `providerConfig.contract.test.ts` enforces that.
 *
 * When promoting types to a shared `@courthive/provider-config` npm
 * package this mirror becomes redundant.
 */

export interface ProviderBranding {
  navbarLogoUrl?: string;
  navbarLogoAlt?: string;
  navbarLogoHeight?: number;
  splashLogoUrl?: string;
  appName?: string;
  accentColor?: string;
}

export interface ProviderPermissions {
  canCreateCompetitors?: boolean;
  canCreateOfficials?: boolean;
  canDeleteParticipants?: boolean;
  canImportParticipants?: boolean;
  canEditParticipantDetails?: boolean;
  canCreateEvents?: boolean;
  canDeleteEvents?: boolean;
  canModifyEventFormat?: boolean;
  canCreateDraws?: boolean;
  canDeleteDraws?: boolean;
  canUseDraftPositioning?: boolean;
  canUseManualPositioning?: boolean;
  allowedDrawTypes?: string[];
  allowedCreationMethods?: string[];
  canModifySchedule?: boolean;
  canUseBulkScheduling?: boolean;
  canCreateVenues?: boolean;
  canDeleteVenues?: boolean;
  canModifyCourtAvailability?: boolean;
  canEnterScores?: boolean;
  canModifyCompletedScores?: boolean;
  allowedScoringApproaches?: string[];
  canPublish?: boolean;
  canUnpublish?: boolean;
  canModifyTournamentDetails?: boolean;
  canModifyPolicies?: boolean;
  canAccessProviderAdmin?: boolean;
}

export interface AllowedCategory {
  ageCategoryCode: string;
  categoryName?: string;
}

export interface ProviderPolicyDefaults {
  schedulingPolicy?: any;
  scoringPolicy?: any;
  seedingPolicy?: any;
  allowedMatchUpFormats?: string[];
  allowedCategories?: AllowedCategory[];
}

export interface ProviderDefaults {
  defaultEventType?: string;
  defaultDrawType?: string;
  defaultCreationMethod?: string;
  defaultGender?: string;
}

export interface ProviderIntegrations {
  ssoProvider?: string;
}

export interface ProviderConfigCaps {
  branding?: ProviderBranding;
  permissions?: Pick<
    ProviderPermissions,
    | 'canCreateCompetitors'
    | 'canCreateOfficials'
    | 'canDeleteParticipants'
    | 'canImportParticipants'
    | 'canEditParticipantDetails'
    | 'canCreateEvents'
    | 'canDeleteEvents'
    | 'canModifyEventFormat'
    | 'canCreateDraws'
    | 'canDeleteDraws'
    | 'canUseDraftPositioning'
    | 'canUseManualPositioning'
    | 'canModifySchedule'
    | 'canUseBulkScheduling'
    | 'canCreateVenues'
    | 'canDeleteVenues'
    | 'canModifyCourtAvailability'
    | 'canEnterScores'
    | 'canModifyCompletedScores'
    | 'canPublish'
    | 'canUnpublish'
    | 'canModifyTournamentDetails'
    | 'canModifyPolicies'
    | 'canAccessProviderAdmin'
    | 'allowedDrawTypes'
    | 'allowedCreationMethods'
    | 'allowedScoringApproaches'
  >;
  policies?: {
    allowedMatchUpFormats?: string[];
    allowedCategories?: AllowedCategory[];
  };
  integrations?: ProviderIntegrations;
}

export interface ProviderConfigSettings {
  permissions?: ProviderPermissions;
  policies?: ProviderPolicyDefaults;
  defaults?: ProviderDefaults;
}

export interface ProviderConfigData {
  branding?: ProviderBranding;
  permissions?: ProviderPermissions;
  policies?: ProviderPolicyDefaults;
  defaults?: ProviderDefaults;
  integrations?: ProviderIntegrations;
}

// Boolean permission keys grouped by surface — drives the editor sections.
// Order matches the planning doc's permissions catalog so the editor reads
// top-to-bottom in the same shape as the docs.
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

export const ARRAY_PERMISSION_KEYS = [
  'allowedDrawTypes',
  'allowedCreationMethods',
  'allowedScoringApproaches',
] as const;

export const PERMISSIONS_DEFAULT_FALSE: ReadonlySet<keyof ProviderPermissions> = new Set([
  'canModifyCompletedScores',
  'canAccessProviderAdmin',
]);

// Validation issue shape returned by both server-side validators.
export interface ValidationIssue {
  path: string;
  code: 'unknownField' | 'wrongType' | 'exceedsCap';
  message: string;
  disallowedValues?: string[];
}
