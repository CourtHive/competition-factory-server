/**
 * Builds a UserContext from a user record + user_providers lookup.
 *
 * Shared by the HTTP AuthMiddleware and the WebSocket TmxGateway so
 * the multi-provider identity hydration is consistent across transports.
 */
import { SUPER_ADMIN, PROVISIONER } from 'src/common/constants/roles';
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
    // Fail closed: a storage error grants no provider role. There is no
    // fallback to the legacy users.provider_id home (shim retired 2026-10-07).
  }

  // A user's provider roles are their user_providers rows, and nothing else. The back-compat shim that read
  // the legacy `users.provider_id` home here (deprecated global `admin` → PROVIDER_ADMIN at the home; a home
  // with no rows → DIRECTOR) was retired 2026-10-07: migration 051 wrote what it granted as rows, measured on
  // prod beforehand to change nobody's access (MULTI_PROVIDER_CONTEXT_COMPLETION.md, Phase 4).

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
    contactEmail: user.contactEmail ?? null,
    emailVerifiedAt: user.emailVerifiedAt
      ? new Date(user.emailVerifiedAt).toISOString()
      : null,
  };
}
