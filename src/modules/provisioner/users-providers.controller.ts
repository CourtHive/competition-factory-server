/**
 * REST surface for managing `user_providers` rows from the admin UI.
 *
 * Backs Phase 2 of `planning/MULTI_PROVIDER_USER_EDIT.md`. Authorization
 * for every endpoint flows through `assertProviderEditor`, which enforces:
 *
 *   SUPER_ADMIN              → unrestricted
 *   PROVISIONER administering P → may edit at P
 *   PROVIDER_ADMIN at P      → may edit at P
 *   anyone else              → 403
 *
 * The GET endpoint returns rows scoped to the editor's authorised
 * providers — a PROVIDER_ADMIN never sees the user's affiliations
 * elsewhere, even with a hand-crafted client.
 */
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';

import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/auth/guards/role.guard';
import { CLIENT, SUPER_ADMIN, PROVIDER_ADMIN } from 'src/common/constants/roles';
import { User } from '../auth/decorators/user.decorator';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';
import { assertProviderEditor } from '../auth/helpers/assertProviderEditor';

import {
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  PROVISIONER_PROVIDER_STORAGE,
  type IProvisionerProviderStorage,
} from 'src/storage/interfaces';

@Controller('provisioner/users')
@UseGuards(RolesGuard)
export class UsersProvidersController {
  constructor(
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE)
    private readonly provisionerProviderStorage: IProvisionerProviderStorage,
  ) {}

  /**
   * List a user's provider associations, scoped to providers the editor
   * is authorised to manage. Super-admins see everything; PROVIDER_ADMIN
   * and PROVISIONER editors see only the rows at their own providers.
   */
  @Get(':userId/providers')
  @Roles([CLIENT, SUPER_ADMIN])
  async list(
    @Param('userId') userId: string,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    if (!userContext) throw new ForbiddenException('Authentication required');

    let allowedProviderIds: string[] | undefined;
    if (!userContext.isSuperAdmin) {
      // Build the set of providers this editor administers — union of
      // PROVIDER_ADMIN-scoped providers and provisioner→provider rows.
      const fromAdmin = Object.entries(userContext.providerRoles ?? {})
        .filter(([, role]) => role === PROVIDER_ADMIN)
        .map(([providerId]) => providerId);
      const fromProvisioner: string[] = [];
      const provisionerIds: string[] = user?.provisionerIds ?? [];
      for (const provisionerId of provisionerIds) {
        const rows = await this.provisionerProviderStorage.findByProvisioner(provisionerId);
        for (const row of rows) fromProvisioner.push(row.providerId);
      }
      allowedProviderIds = Array.from(new Set([...fromAdmin, ...fromProvisioner]));
    }

    return this.userProviderStorage.findByUserIdEnriched(userId, allowedProviderIds);
  }

  /**
   * Upsert a user-provider association. Used to add a new provider to
   * a user, or to change an existing row's role.
   */
  @Put(':userId/providers/:providerId')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async upsert(
    @Param('userId') userId: string,
    @Param('providerId') providerId: string,
    @Body() body: { providerRole?: string },
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    await assertProviderEditor({
      userContext,
      providerId,
      provisionerIds: user?.provisionerIds,
      provisionerProviderStorage: this.provisionerProviderStorage,
    });

    const providerRole = body?.providerRole;
    if (providerRole !== PROVIDER_ADMIN && providerRole !== 'DIRECTOR') {
      throw new ConflictException('providerRole must be PROVIDER_ADMIN or DIRECTOR');
    }

    // Last-admin-block: refuse to demote the last PROVIDER_ADMIN at this
    // provider. Counts existing admins and rejects the change if it would
    // leave the provider with zero administrators.
    if (providerRole === 'DIRECTOR') {
      await this.assertNotLastAdmin(providerId, userId);
    }

    await this.userProviderStorage.upsert({ userId, providerId, providerRole });
    return this.userProviderStorage.findOne(userId, providerId);
  }

  /**
   * Remove a user-provider association. Tournament_assignments rows at
   * this provider are *not* cleaned up — they're inert without the
   * parent user_providers row (auth check denies before they're
   * consulted) and re-adding the user restores effective grants.
   */
  @Delete(':userId/providers/:providerId')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('userId') userId: string,
    @Param('providerId') providerId: string,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    await assertProviderEditor({
      userContext,
      providerId,
      provisionerIds: user?.provisionerIds,
      provisionerProviderStorage: this.provisionerProviderStorage,
    });

    // Last-admin-block also gates remove — can't leave the provider
    // with no administrators.
    await this.assertNotLastAdmin(providerId, userId);

    return this.userProviderStorage.remove(userId, providerId);
  }

  /**
   * Throw 409 if removing or demoting the user-provider row at
   * `providerId` would leave the provider with no PROVIDER_ADMIN.
   * No-op when the targeted row isn't a PROVIDER_ADMIN to begin with
   * (demoting a DIRECTOR or removing a DIRECTOR is always fine).
   */
  private async assertNotLastAdmin(providerId: string, userId: string): Promise<void> {
    const targetRow = await this.userProviderStorage.findOne(userId, providerId);
    if (!targetRow || targetRow.providerRole !== PROVIDER_ADMIN) return;

    const allRows = await this.userProviderStorage.findByProviderId(providerId);
    const adminCount = allRows.filter((r) => r.providerRole === PROVIDER_ADMIN).length;
    if (adminCount <= 1) {
      throw new ConflictException(
        `Provider must retain at least one PROVIDER_ADMIN (would leave provider ${providerId} with 0)`,
      );
    }
  }
}
