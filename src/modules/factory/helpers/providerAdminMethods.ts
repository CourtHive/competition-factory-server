import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

/**
 * Mutations only a provider administrator may run, however the user otherwise reaches the tournament (creator,
 * DIRECTOR assignment, scoped grant). The provider permission map caps what a PROVIDER may do; this caps WHO within
 * it may do it.
 *
 * `mergeIndividualParticipants` (CA, 2026-11-13): consolidation retires a participant identity. API keys have no need
 * to merge (CA, 2026-11-13), so their synthetic PROVIDER_ADMIN does not count here.
 */
export const PROVIDER_ADMIN_METHODS: ReadonlySet<string> = new Set(['mergeIndividualParticipants']);

/** The first requested method reserved for provider administrators, if any. */
export function providerAdminMethod(requestedMethods: string[]): string | undefined {
  return requestedMethods.find((method) => PROVIDER_ADMIN_METHODS.has(method));
}

/**
 * A provider administrator of `providerId`: a super-admin, a PROVIDER_ADMIN at that provider, or a provisioner that
 * administers it. A provider-less tournament has no administrator but a super-admin. An API key (provisioner or
 * provider) is never one: its PROVIDER_ADMIN role is synthetic, minted by the key middleware.
 */
export function isProviderAdministrator(userContext: UserContext | undefined, providerId: string | undefined) {
  if (!userContext || userContext.apiKey) return false;
  if (userContext.isSuperAdmin) return true;
  if (!providerId) return false;
  if (userContext.provisionerProviderIds?.includes(providerId)) return true;
  return userContext.providerRoles?.[providerId] === PROVIDER_ADMIN;
}
