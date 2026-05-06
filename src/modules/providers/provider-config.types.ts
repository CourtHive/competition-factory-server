/**
 * Provider configuration types — canonical source of truth.
 *
 * Two-tier model:
 *   - ProviderConfigCaps      (provisioner-owned: white-label,
 *                              permission ceilings, allowed universes)
 *   - ProviderConfigSettings  (provider-admin-owned: may-disable,
 *                              narrowing, operational policy + defaults)
 *   - ProviderConfigData      (effective shape, computed by merging
 *                              caps ∩ settings — what TMX consumes)
 *
 * TMX has a duplicate of this type at TMX/src/config/providerConfig.ts;
 * a contract test there asserts the mirror still matches this canonical
 * source. Drift is loud, not silent.
 *
 * See `Mentat/planning/TMX_PROVIDER_CONFIG_FEATURES.md` for the full
 * design rationale, the field-ownership matrix, and the merge rules.
 */

// ── Sub-types (shared across caps + settings + effective) ──

export interface ProviderBranding {
  /** URL or data-URI for navbar logo (replaces "TMX" text) */
  navbarLogoUrl?: string;
  /** Alt text for navbar logo */
  navbarLogoAlt?: string;
  /** Max height in px for navbar logo (default: 32) */
  navbarLogoHeight?: number;
  /** URL or data-URI for splash/login screen logo (replaces CourtHive hex) */
  splashLogoUrl?: string;
  /** Application name shown in page title and nav bar (default: "TMX") */
  appName?: string;
  /** Optional accent color override (CSS color value) */
  accentColor?: string;
}

export interface ProviderPermissions {
  // ── Participants ──
  canCreateCompetitors?: boolean;
  canCreateOfficials?: boolean;
  canDeleteParticipants?: boolean;
  canImportParticipants?: boolean;
  canEditParticipantDetails?: boolean;

  // ── Events ──
  canCreateEvents?: boolean;
  canDeleteEvents?: boolean;
  canModifyEventFormat?: boolean;

  // ── Draws ──
  canCreateDraws?: boolean;
  canDeleteDraws?: boolean;
  canUseDraftPositioning?: boolean;
  canUseManualPositioning?: boolean;
  /** Restrict draw types to this list (factory drawType constants). Empty = all allowed. */
  allowedDrawTypes?: string[];
  /** Restrict creation methods. Empty = all allowed. */
  allowedCreationMethods?: string[];

  // ── Scheduling ──
  canModifySchedule?: boolean;
  canUseBulkScheduling?: boolean;

  // ── Venues ──
  canCreateVenues?: boolean;
  canDeleteVenues?: boolean;
  canModifyCourtAvailability?: boolean;

  // ── Scoring ──
  canEnterScores?: boolean;
  canModifyCompletedScores?: boolean;
  allowedScoringApproaches?: string[];

  // ── Publishing ──
  canPublish?: boolean;
  canUnpublish?: boolean;

  // ── Settings ──
  canModifyTournamentDetails?: boolean;
  canModifyPolicies?: boolean;
  canAccessProviderAdmin?: boolean;
}

export interface AllowedCategory {
  ageCategoryCode: string;
  categoryName?: string;
}

/**
 * Per-print-type composition policies. Opaque to the server — the
 * shape is owned by pdf-factory's `CompositionConfig` type, validated
 * client-side by the editor. Stored as JSON in
 * `providerConfigSettings.policies.printPolicies`.
 *
 * Keys are pdf-factory `PrintType` values (`'draw'`, `'schedule'`,
 * `'playerList'`, `'courtCard'`, `'signInSheet'`, `'matchCard'`).
 *
 * See `Mentat/planning/PRINT_COMPOSITION_POLICY_PLAN.md`.
 */
export type PrintPoliciesByType = Record<string, unknown>;

export interface ProviderPolicyDefaults {
  /** Scheduling policy applied to new tournaments */
  schedulingPolicy?: any;
  /** Scoring policy */
  scoringPolicy?: any;
  /** Seeding policy */
  seedingPolicy?: any;
  /** Restrict matchUp formats to this list (format codes) */
  allowedMatchUpFormats?: string[];
  /** Restrict event categories to this list */
  allowedCategories?: AllowedCategory[];
  /** Per-print-type composition policies (pdf-factory CompositionConfig per type) */
  printPolicies?: PrintPoliciesByType;
}

export interface ProviderDefaults {
  /** Default event type for new events */
  defaultEventType?: string;
  /** Default draw type for new draws */
  defaultDrawType?: string;
  /** Default creation method */
  defaultCreationMethod?: string;
  /** Default gender */
  defaultGender?: string;
}

export interface ProviderIntegrations {
  ssoProvider?: string;
}

// ── Cap-tier schema (provisioner-owned) ──

/**
 * Caps-eligible permission keys. Subset of ProviderPermissions —
 * branding, integrations, policies.allowedX live elsewhere on the
 * caps shape.
 */
export type CappablePermissionKey =
  // Boolean caps
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
  // Array (allowed-universe) caps
  | 'allowedDrawTypes'
  | 'allowedCreationMethods'
  | 'allowedScoringApproaches';

export type ProviderCapsPermissions = Pick<ProviderPermissions, CappablePermissionKey>;

export interface ProviderCapsPolicies {
  /** Universe of matchUpFormat codes the provider may use */
  allowedMatchUpFormats?: string[];
  /** Universe of event categories the provider may offer */
  allowedCategories?: AllowedCategory[];
}

/**
 * Granular fields the provider may opt to publish on participants.
 * Default for every field is `false` — privacy-first. Each toggle
 * relaxes a single attribute that the default privacy policy
 * (`POLICY_PRIVACY_DEFAULT`) otherwise strips from public payloads.
 */
export interface ProviderParticipantPrivacy {
  /** Allow `person.addresses[0].city / .state` through to the public
   *  participants endpoint (full street / postal code stay stripped). */
  cityState?: boolean;
}

/**
 * Provisioner-owned configuration — the "ceiling" the provider
 * cannot exceed. Provider admin writes to ProviderConfigSettings
 * may not violate caps.
 */
export interface ProviderConfigCaps {
  branding?: ProviderBranding;
  permissions?: ProviderCapsPermissions;
  policies?: ProviderCapsPolicies;
  integrations?: ProviderIntegrations;
  participantPrivacy?: ProviderParticipantPrivacy;
}

// ── Settings-tier schema (provider-admin-owned) ──

/**
 * Provider-admin-owned configuration — the day-to-day tuning the
 * provider does within the cap ceiling. May disable booleans that
 * caps allow; may narrow allowedX arrays; owns operational policies
 * and defaults entirely.
 */
export interface ProviderConfigSettings {
  permissions?: ProviderPermissions;
  policies?: ProviderPolicyDefaults;
  defaults?: ProviderDefaults;
}

// ── Effective shape (delivered to TMX) ──

/**
 * The merged shape TMX consumes. TMX has no awareness of the
 * caps/settings split — it only sees the result of
 * `computeEffectiveConfig(caps, settings)`.
 */
export interface ProviderConfigData {
  branding?: ProviderBranding;
  permissions?: ProviderPermissions;
  policies?: ProviderPolicyDefaults;
  defaults?: ProviderDefaults;
  integrations?: ProviderIntegrations;
  participantPrivacy?: ProviderParticipantPrivacy;
}

// ── Helper enumerations for the merge function and validators ──

export type BooleanPermissionKey =
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
  | 'canAccessProviderAdmin';

export type ArrayPermissionKey = 'allowedDrawTypes' | 'allowedCreationMethods' | 'allowedScoringApproaches';

export const BOOLEAN_PERMISSION_KEYS: ReadonlyArray<BooleanPermissionKey> = [
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

export const ARRAY_PERMISSION_KEYS: ReadonlyArray<ArrayPermissionKey> = [
  'allowedDrawTypes',
  'allowedCreationMethods',
  'allowedScoringApproaches',
] as const;

export const ARRAY_POLICY_KEYS: ReadonlyArray<keyof ProviderPolicyDefaults> = [
  'allowedMatchUpFormats',
  'allowedCategories',
] as const;

/**
 * Permissions that default to `false` when no value is set.
 * Most permissions default to `true` (permissive); this set lists
 * the exceptions where the absence of an explicit decision should
 * be treated as "denied".
 */
export const PERMISSIONS_DEFAULT_FALSE: ReadonlySet<keyof ProviderPermissions> = new Set([
  'canModifyCompletedScores',
  'canAccessProviderAdmin',
]);
