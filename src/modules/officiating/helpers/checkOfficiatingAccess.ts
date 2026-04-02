import { SUPER_ADMIN, ADMIN } from 'src/common/constants/roles';

function getUserProviderIds(user: any): string[] {
  if (user?.providerIds?.length) return user.providerIds;
  if (user?.providerId) return [user.providerId];
  return [];
}

/**
 * Returns true if the user owns the official record or is ADMIN/SUPER_ADMIN.
 */
export function canAccessOfficialRecord({ officialRecord, user }: { officialRecord: any; user: any }): boolean {
  if (!user) return false;
  if (user.roles?.includes(SUPER_ADMIN)) return true;

  const providerIds = getUserProviderIds(user);
  const recordProviderId = officialRecord?.providerId;

  if (user.roles?.includes(ADMIN) && recordProviderId && providerIds.includes(recordProviderId)) {
    return true;
  }

  if (recordProviderId && providerIds.includes(recordProviderId)) {
    return true;
  }

  return false;
}

/**
 * Returns true if the user can perform evaluator actions (create/submit evaluations).
 * ADMIN and SUPER_ADMIN roles can evaluate.
 */
export function canEvaluateOfficial({ user }: { user: any }): boolean {
  if (!user) return false;
  return user.roles?.includes(SUPER_ADMIN) || user.roles?.includes(ADMIN);
}

/**
 * Returns true if the user can manage official records (create, certify, suspend).
 * Requires provider context.
 */
export function canManageOfficials({ user }: { user: any }): boolean {
  if (!user) return false;
  return getUserProviderIds(user).length > 0 || user.roles?.includes(SUPER_ADMIN);
}

/**
 * Returns the provider ID to scope listing queries to.
 * SUPER_ADMIN sees all; others see only their provider(s).
 */
export function getOfficiatingScopeProviderId({ user }: { user: any }): string | undefined {
  if (!user) return undefined;
  if (user.roles?.includes(SUPER_ADMIN)) return undefined;
  return user.providerId;
}

// Methods that only evaluators (ADMIN/SUPER_ADMIN) can invoke
export const EVALUATOR_METHODS = [
  'addEvaluation',
  'modifyEvaluation',
  'removeEvaluation',
  'transitionEvaluationStatus',
  'addSuspension',
  'removeSuspension',
];

// Methods that managers (anyone with provider context) can invoke on their records
export const MANAGER_METHODS = [
  'addCertification',
  'modifyCertification',
  'removeCertification',
  'transitionCertificationStatus',
  'addCertificationRequirement',
  'assignOfficial',
  'removeOfficialAssignment',
  'transitionAssignmentStatus',
  'addEvaluationPolicy',
];

// Query methods anyone with access can call
export const QUERY_METHODS = [
  'getOfficialRecord',
  'getOfficialCertifications',
  'validateCertification',
  'getEvaluations',
  'getEvaluationSummary',
  'getOfficialEligibility',
  'getOfficialAssignments',
  'getEvaluationTemplate',
];
