/**
 * Authorization helper for endpoints that mutate `user_providers` rows.
 *
 * The "may this editor manage user-provider associations at provider P"
 * decision shows up in three endpoints (GET / PUT / DELETE on
 * `/provisioner/users/:userId/providers/:providerId`) plus the new-user
 * scope check in `/auth/admin-create-user`. Centralising it here keeps
 * the rule consistent and testable in isolation.
 *
 * Rule (per planning/MULTI_PROVIDER_USER_EDIT.md, Resolved Decisions):
 *
 *   SUPER_ADMIN              → unrestricted
 *   PROVISIONER administering P → may edit at P
 *   PROVIDER_ADMIN at P      → may edit at P
 *   anyone else              → 403
 *
 * One subtlety: when a request is authenticated as a provisioner
 * (`req.provisioner` set — API key or PROVISIONER-role JWT), ProvisionerMiddleware
 * mints a *synthetic* `providerRoles[P] = PROVIDER_ADMIN` for the impersonated
 * provider so tournament/score endpoints work unchanged. That synthetic role must
 * NOT be treated as real PROVIDER_ADMIN authority for user administration —
 * otherwise a bare `prov_` API key + `X-Provider-Id` could create/modify/reset
 * users (the loophole this guards against). Callers pass `isProvisioner` so that,
 * for provisioner-authenticated requests, authority must come from a real
 * provisioner→provider relationship (`provisionerIds`) — which an API key, having
 * no `provisionerIds`, never satisfies. A PROVISIONER-role JWT user still passes
 * via that relationship branch; a plain PROVIDER_ADMIN human (no `req.provisioner`)
 * still passes via `providerRoles`.
 */
import { ForbiddenException } from '@nestjs/common';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import type { UserContext } from '../decorators/user-context.decorator';
import type { IProvisionerProviderStorage } from 'src/storage/interfaces';

export interface AssertProviderEditorArgs {
  userContext: UserContext | undefined;
  providerId: string;
  /**
   * Provisioner IDs from the editor's JWT (populated by signIn for users
   * with the PROVISIONER role — see `auth.service.ts`). Empty / undefined
   * means the editor isn't a provisioner.
   */
  provisionerIds?: string[];
  /** Required when `provisionerIds` is non-empty so the provisioner→provider relationship can be checked. */
  provisionerProviderStorage?: IProvisionerProviderStorage;
  /**
   * True when the request is authenticated as a provisioner (`req.provisioner`
   * is set). When true, the synthetic `providerRoles[providerId] === PROVIDER_ADMIN`
   * minted by ProvisionerMiddleware is ignored — authority must come from a real
   * provisioner→provider relationship via `provisionerIds`. Closes the API-key
   * loophole where `prov_` + `X-Provider-Id` could administer users.
   */
  isProvisioner?: boolean;
}

/**
 * Throws `ForbiddenException` if the editor isn't authorised to manage
 * user_provider rows at `providerId`. Returns void on success.
 */
export async function assertProviderEditor(args: AssertProviderEditorArgs): Promise<void> {
  const { userContext, providerId, provisionerIds, provisionerProviderStorage, isProvisioner } = args;
  if (!userContext) throw new ForbiddenException('Authentication required');

  if (userContext.isSuperAdmin) return;

  // A real PROVIDER_ADMIN (human with a user_providers row) is authorised here.
  // Skip this branch for provisioner-authenticated requests: their PROVIDER_ADMIN
  // role is synthetic (minted from the provisioner→provider relationship), so it
  // must be re-proven via `provisionerIds` below rather than trusted outright.
  if (!isProvisioner && userContext.providerRoles?.[providerId] === PROVIDER_ADMIN) return;

  if (provisionerIds?.length && provisionerProviderStorage) {
    for (const provisionerId of provisionerIds) {
      const relationship = await provisionerProviderStorage.getRelationship(provisionerId, providerId);
      if (relationship !== null) return;
    }
  }

  throw new ForbiddenException(
    `Not authorised to manage user-provider associations at provider ${providerId}`,
  );
}
