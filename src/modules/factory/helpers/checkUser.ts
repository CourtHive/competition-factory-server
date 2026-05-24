import { SUPER_ADMIN } from 'src/common/constants/roles';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

/**
 * Gate: is the caller allowed to operate on tournaments at all?
 * True for a SUPER_ADMIN or any user associated with at least one provider.
 *
 * Multi-provider users carry their associations in `userContext` (hydrated
 * from `user_providers` by the auth middleware), NOT on the legacy JWT
 * `providerId`/`providerIds` fields — those are empty for accounts created
 * in the multi-provider era (their `users.provider_id` is blank and the
 * association lives only in `user_providers`). Consult `userContext` first
 * so such a user (e.g. a provider DIRECTOR with no legacy `provider_id`) is
 * not falsely rejected with `Invalid user` — which surfaces in TMX as a
 * misleading "Tournament not found". Mirrors checkProvider's resolution.
 *
 * @returns boolean
 */
export function checkUser({ user, userContext }: { user?: any; userContext?: UserContext }) {
  if (userContext?.isSuperAdmin) return true;
  if (userContext?.providerIds?.length) return true;
  if (userContext?.provisionerProviderIds?.length) return true;
  return !!(user?.roles?.includes(SUPER_ADMIN) || user?.providerIds?.length || user?.providerId);
}
