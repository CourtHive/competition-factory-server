/**
 * Builds a UserContext from a user record + user_providers lookup.
 *
 * Shared by the HTTP AuthMiddleware and the WebSocket TmxGateway so
 * the multi-provider identity hydration is consistent across transports.
 */
import { SUPER_ADMIN, ADMIN, PROVIDER_ADMIN } from 'src/common/constants/roles';
import type { IUserProviderStorage } from 'src/storage/interfaces';
import type { UserContext } from '../decorators/user-context.decorator';

export async function buildUserContext(
  user: any,
  userProviderStorage: IUserProviderStorage,
): Promise<UserContext> {
  const globalRoles: string[] = user.roles ?? [];
  const isSuperAdmin = globalRoles.includes(SUPER_ADMIN);

  const providerRoles: Record<string, string> = {};
  try {
    const rows = await userProviderStorage.findByUserId(user.userId ?? user.user_id);
    for (const row of rows) {
      providerRoles[row.providerId] = row.providerRole;
    }
  } catch {
    // user_providers table may not exist yet (LevelDB stub throws, or
    // migrations haven't run). Fall back to the legacy singular providerId.
  }

  // Back-compat shim: deprecated 'admin' role → PROVIDER_ADMIN
  if (globalRoles.includes(ADMIN) && user.providerId && !providerRoles[user.providerId]) {
    providerRoles[user.providerId] = PROVIDER_ADMIN;
  }
  if (Object.keys(providerRoles).length === 0 && user.providerId) {
    providerRoles[user.providerId] = 'DIRECTOR';
  }

  return {
    userId: user.userId ?? user.user_id ?? '',
    email: user.email,
    isSuperAdmin,
    globalRoles,
    providerRoles,
    providerIds: Object.keys(providerRoles),
  };
}
