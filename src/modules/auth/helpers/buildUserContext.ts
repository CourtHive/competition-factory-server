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

  // Back-compat shim: deprecated 'admin' global role → PROVIDER_ADMIN at the
  // user's home provider. Always overrides whatever may be in user_providers
  // because role-array edits via the admin "Edit User" flow only touch the
  // legacy `users.roles` JSONB and never sync to `user_providers.provider_role`,
  // so the `user_providers` row drifts stale the moment admin is granted.
  // Promoting unconditionally on every buildUserContext keeps the legacy
  // `'admin'` role authoritative until the role is fully retired.
  if (globalRoles.includes(ADMIN) && user.providerId) {
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
