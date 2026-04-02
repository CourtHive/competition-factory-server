import { SUPER_ADMIN, ADMIN } from 'src/common/constants/roles';

/**
 * Extracts the user's provider IDs from the JWT-populated user object.
 */
function getUserProviderIds(user: any): string[] {
  if (user?.providerIds?.length) return user.providerIds;
  if (user?.providerId) return [user.providerId];
  return [];
}

/**
 * Returns true if the user owns the sanctioning record (is the applicant provider).
 * SUPER_ADMIN always passes. ADMIN passes if they share a provider.
 */
export function canAccessSanctioningRecord({ sanctioningRecord, user }: { sanctioningRecord: any; user: any }): boolean {
  if (!user) return false;
  if (user.roles?.includes(SUPER_ADMIN)) return true;

  const providerIds = getUserProviderIds(user);
  const recordProviderId = sanctioningRecord?.applicantProviderId;

  // Admin users can access all records for their provider
  if (user.roles?.includes(ADMIN) && recordProviderId && providerIds.includes(recordProviderId)) {
    return true;
  }

  // Client users can access their own provider's records
  if (recordProviderId && providerIds.includes(recordProviderId)) {
    return true;
  }

  return false;
}

/**
 * Returns true if the user can perform reviewer actions (review, approve, reject, etc.)
 * Only ADMIN and SUPER_ADMIN roles can review.
 */
export function canReviewSanctioning({ user }: { user: any }): boolean {
  if (!user) return false;
  return user.roles?.includes(SUPER_ADMIN) || user.roles?.includes(ADMIN);
}

/**
 * Returns true if the user can create/edit/submit sanctioning applications.
 * CLIENT, ADMIN, and SUPER_ADMIN roles can apply.
 */
export function canApplySanctioning({ user }: { user: any }): boolean {
  if (!user) return false;
  return getUserProviderIds(user).length > 0 || user.roles?.includes(SUPER_ADMIN);
}

/**
 * Returns the provider ID to scope listing queries to.
 * SUPER_ADMIN sees all; others see only their provider(s).
 */
export function getSanctioningScopeProviderId({ user }: { user: any }): string | undefined {
  if (!user) return undefined;
  if (user.roles?.includes(SUPER_ADMIN)) return undefined; // no filter — sees all
  return user.providerId;
}

// Methods that only reviewers (ADMIN/SUPER_ADMIN) can invoke
export const REVIEWER_METHODS = [
  'reviewApplication',
  'approveApplication',
  'conditionallyApprove',
  'rejectApplication',
  'requestModification',
  'verifyComplianceItem',
  'waiveComplianceItem',
  'flagComplianceIssues',
  'closeApplication',
  'reviewAmendment',
];

// Methods that applicants (CLIENT) can invoke on their own records
export const APPLICANT_METHODS = [
  'updateProposal',
  'addEventProposal',
  'removeEventProposal',
  'updateEventProposal',
  'submitApplication',
  'withdrawApplication',
  'requestEndorsement',
  'endorseApplication',
  'declineEndorsement',
  'addReviewNote',
  'proposeAmendment',
  'submitComplianceItem',
  'transitionToPostEvent',
];

// Query methods anyone with access can call
export const QUERY_METHODS = [
  'getSanctioningRecord',
  'getAvailableTransitions',
  'getStatusHistory',
  'getCompleteness',
  'getEligibleTiers',
  'validateProposal',
  'getCalendarConflicts',
];
