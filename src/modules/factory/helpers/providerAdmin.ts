import { PROVIDER_ADMIN } from 'src/common/constants/roles';

import type { UserContext } from '../../account/auth/decorators/user-context.decorator';

/**
 * May this caller administer `providerId`?
 *
 * The one rule for provider-scoped administration: PROVIDER_ADMIN at that
 * provider, or SUPER_ADMIN. `AssignmentsService` and `GrantsService` both
 * authorize with it, and they must agree — a grant that can be created by
 * someone who could not create the coarser assignment would be a way around
 * the assignment gate.
 *
 * Fails closed on a missing provider: a caller cannot administer a provider
 * that could not be resolved, and a super-admin has nothing to administer
 * there either.
 */
export function isProviderAdminFor(ctx: UserContext | undefined, providerId: string | undefined): boolean {
  if (!ctx || !providerId) return false;
  if (ctx.isSuperAdmin) return true;
  return ctx.providerRoles?.[providerId] === PROVIDER_ADMIN;
}

/** The denial every caller of `isProviderAdminFor` returns, so the wording cannot drift. */
export const INSUFFICIENT_PERMISSIONS = 'Insufficient permissions — must be PROVIDER_ADMIN or SUPER_ADMIN';
