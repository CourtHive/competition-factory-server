/**
 * Builds a UserContext from a user record + user_providers lookup.
 *
 * Shared by the HTTP AuthMiddleware and the WebSocket TmxGateway so
 * the multi-provider identity hydration is consistent across transports.
 */
import { SUPER_ADMIN, ADMIN, PROVIDER_ADMIN, PROVISIONER } from 'src/common/constants/roles';
import type {
  IUserProviderStorage,
  IUserProvisionerStorage,
  IProvisionerProviderStorage,
} from 'src/storage/interfaces';
import type { UserContext } from '../decorators/user-context.decorator';

export interface BuildUserContextDeps {
  userProviderStorage: IUserProviderStorage;
  userProvisionerStorage?: IUserProvisionerStorage;
  provisionerProviderStorage?: IProvisionerProviderStorage;
}

/**
 * Overload kept for back-compat: pre-provisioner callers passed just the
 * user_providers storage. New callers should pass the full deps bag so the
 * resulting context carries `provisionerProviderIds` — without it,
 * provisioner-admin requests are denied at endpoints that gate on
 * `providerIds.includes(...)`.
 */
export async function buildUserContext(
  user: any,
  deps: IUserProviderStorage | BuildUserContextDeps,
): Promise<UserContext> {
  const {
    userProviderStorage,
    userProvisionerStorage,
    provisionerProviderStorage,
  }: BuildUserContextDeps =
    'findByUserId' in (deps as any)
      ? { userProviderStorage: deps as IUserProviderStorage }
      : (deps as BuildUserContextDeps);

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

  // Provisioner-inherited provider visibility. Only fired when the user
  // carries the PROVISIONER global role AND the caller passed both
  // storages — without that, fall back to an empty set so existing code
  // paths that haven't migrated are no worse than before.
  let provisionerProviderIds: string[] = [];
  if (
    !isSuperAdmin &&
    globalRoles.includes(PROVISIONER) &&
    userProvisionerStorage &&
    provisionerProviderStorage
  ) {
    try {
      const provisionerIds = await userProvisionerStorage.findProvisionerIdsByUser(
        user.userId ?? user.user_id,
      );
      const seen = new Set<string>();
      for (const provisionerId of provisionerIds) {
        const rows = await provisionerProviderStorage.findByProvisioner(provisionerId);
        for (const row of rows) seen.add(row.providerId);
      }
      provisionerProviderIds = Array.from(seen);
    } catch {
      // Either table may be absent on a legacy storage backend — fall
      // back to an empty set; existing direct-association checks still
      // apply, so we degrade rather than crash.
    }
  }

  return {
    userId: user.userId ?? user.user_id ?? '',
    email: user.email,
    isSuperAdmin,
    globalRoles,
    providerRoles,
    providerIds: Object.keys(providerRoles),
    provisionerProviderIds,
  };
}
