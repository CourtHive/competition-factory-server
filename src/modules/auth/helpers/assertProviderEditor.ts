/**
 * Authorization helper for endpoints that mutate `user_providers` rows.
 *
 * The "may this editor manage user-provider associations at provider P"
 * decision shows up in three endpoints (GET / PUT / DELETE on
 * `/provisioner/users/:userId/providers/:providerId`) plus the
 * existing-email-detection branch of `/auth/invite`. Centralising it
 * here keeps the rule consistent and testable in isolation.
 *
 * Rule (per planning/MULTI_PROVIDER_USER_EDIT.md, Resolved Decisions):
 *
 *   SUPER_ADMIN              → unrestricted
 *   PROVISIONER administering P → may edit at P
 *   PROVIDER_ADMIN at P      → may edit at P
 *   anyone else              → 403
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
}

/**
 * Throws `ForbiddenException` if the editor isn't authorised to manage
 * user_provider rows at `providerId`. Returns void on success.
 */
export async function assertProviderEditor(args: AssertProviderEditorArgs): Promise<void> {
  const { userContext, providerId, provisionerIds, provisionerProviderStorage } = args;
  if (!userContext) throw new ForbiddenException('Authentication required');

  if (userContext.isSuperAdmin) return;

  if (userContext.providerRoles?.[providerId] === PROVIDER_ADMIN) return;

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
