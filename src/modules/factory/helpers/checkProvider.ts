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
 */
export function checkProvider({ tournamentRecords, user, userContext }: {
  tournamentRecords: any;
  user?: any;
  userContext?: UserContext;
}) {
  // Super admin bypass — check both sources
  if (userContext?.isSuperAdmin) return true;
  if (user?.roles?.includes(SUPER_ADMIN)) return true;

  // Resolve the user's provider ID list from the best available source
  const providerIds = userContext?.providerIds?.length
    ? userContext.providerIds
    : user?.providerIds?.length
      ? user.providerIds
      : user?.providerId
        ? [user.providerId]
        : [];

  for (const tournamentId in tournamentRecords ?? {}) {
    const providerId = tournamentRecords[tournamentId]?.parentOrganisation?.organisationId;
    if (providerId && !providerIds.includes(providerId)) return false;
  }
  return true;
}
