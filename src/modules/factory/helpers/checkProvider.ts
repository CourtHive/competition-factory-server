import { SUPER_ADMIN } from 'src/common/constants/roles';
import type { UserContext } from 'src/modules/auth/decorators/user-context.decorator';

/**
 * Provider-level gate for tournament operations.
 *
 * Returns true if every tournament in `tournamentRecords` belongs to a
 * provider the user is associated with. Accepts either:
 *   - `userContext` (new multi-provider lookup from middleware), or
 *   - `user` (legacy JWT-hydrated object with providerId / providerIds)
 *
 * When `userContext` is available it takes precedence — its providerIds
 * come from the `user_providers` table and are always current.
 *
 * Also honors `userContext.provisionerProviderIds` — the impersonation
 * handoff from /admin lets a provisioner admin act on tournaments owned
 * by providers their provisioner manages, even without a direct
 * user_providers row.
 */
export function checkProvider({ tournamentRecords, user, userContext }: {
  tournamentRecords: any;
  user?: any;
  userContext?: UserContext;
}) {
  // Super admin bypass — check both sources
  if (userContext?.isSuperAdmin) return true;
  if (user?.roles?.includes(SUPER_ADMIN)) return true;

  // Resolve the user's provider ID list from the best available source.
  // Concatenate provisioner-inherited provider IDs so impersonation can
  // pass the gate (empty set for non-provisioner users).
  const directIds = userContext?.providerIds?.length
    ? userContext.providerIds
    : user?.providerIds?.length
      ? user.providerIds
      : user?.providerId
        ? [user.providerId]
        : [];
  const provisionerIds = userContext?.provisionerProviderIds ?? [];
  const providerIds = [...directIds, ...provisionerIds];

  for (const tournamentId in tournamentRecords ?? {}) {
    const providerId = tournamentRecords[tournamentId]?.parentOrganisation?.organisationId;
    if (providerId && !providerIds.includes(providerId)) return false;
  }
  return true;
}
