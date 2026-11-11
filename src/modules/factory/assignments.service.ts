import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ASSIGNMENT_STORAGE,
  type IAssignmentStorage,
  type TournamentAssignmentRow,
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  USER_STORAGE,
  type IUserStorage,
} from 'src/storage/interfaces';
import { INSUFFICIENT_PERMISSIONS, isProviderAdminFor } from './helpers/providerAdmin';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';

import type { UserContext } from '../account/auth/decorators/user-context.decorator';

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    @Inject(ASSIGNMENT_STORAGE) private readonly assignmentStorage: IAssignmentStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  /**
   * The provider that OWNS a tournament, from the storage projection (the record itself is never loaded), and the
   * only provider an assignment route authorizes against. Until 2026-11-08 grant and revoke authorized against the
   * `providerId` the CALLER sent, never checked against the tournament: an admin of provider X could revoke anyone's
   * access to provider Y's tournament, and write X's users onto it, by sending `providerId: X`. A `providerId` in the
   * request is now only a claim, refused when it is not the owner. Mirrors GrantsService.resolveProviderId.
   */
  private async owningProvider(tournamentId: string | undefined, claimed?: string) {
    if (!tournamentId) return { error: 'tournamentId is required' };
    const view: any = await this.tournamentStorageService.fetchTournamentUpdatedAt({ tournamentId });
    const providerId: string | undefined = view?.success ? view.providerId : undefined;
    if (!providerId) return { error: 'Tournament not found, or it has no provider' };
    if (claimed && claimed !== providerId) return { error: 'providerId is not the provider of this tournament' };
    return { providerId };
  }

  /**
   * A tournament's assignments, for whoever may change them (its provider's admin, or a super-admin) — or, with no
   * tournamentId, the caller's own. The tournament form had no check at all until 2026-11-08: any authenticated
   * admin-audience token could list who is assigned to any tournament, emails included.
   */
  async list(params: { tournamentId?: string }, userContext: UserContext) {
    if (params.tournamentId) {
      const owner = await this.owningProvider(params.tournamentId);
      if (owner.error) return { error: owner.error };
      if (!isProviderAdminFor(userContext, owner.providerId)) return { error: INSUFFICIENT_PERMISSIONS };
      return { success: true, assignments: await this.assignmentStorage.findByTournamentId(params.tournamentId) };
    }
    return { success: true, assignments: await this.assignmentStorage.findByUserId(userContext.userId) };
  }

  /** Grant a user access to a tournament. Validates grantor role and grantee provider membership. */
  async grant(
    params: { tournamentId: string; userEmail: string; providerId: string; role?: string },
    grantor: UserContext,
  ) {
    const { tournamentId, userEmail, role } = params;

    const owner = await this.owningProvider(tournamentId, params.providerId);
    if (owner.error) return { error: owner.error };
    const providerId = owner.providerId!;

    // Grantor must be PROVIDER_ADMIN for the tournament's provider or SUPER_ADMIN
    if (!isProviderAdminFor(grantor, providerId)) {
      return { error: INSUFFICIENT_PERMISSIONS };
    }

    // Resolve grantee's userId from email
    const grantee = await this.userStorage.findOne(userEmail);
    if (!grantee) return { error: 'User not found' };
    const granteeUserId = grantee.userId ?? grantee.user_id;
    if (!granteeUserId) return { error: 'User has no UUID — schema migration may not have run' };

    // Grantee must have a user_providers row for this provider
    const association = await this.userProviderStorage.findOne(granteeUserId, providerId);
    if (!association) {
      return { error: 'User is not associated with this provider — invite them first' };
    }

    const row: TournamentAssignmentRow = {
      tournamentId,
      userId: granteeUserId,
      providerId,
      assignmentRole: role || 'DIRECTOR',
      grantedBy: grantor.userId,
    };

    await this.assignmentStorage.grant(row);
    this.logger.log(`Granted ${userEmail} access to ${tournamentId} (role: ${row.assignmentRole})`);

    return { success: true, assignment: { ...row, email: userEmail } };
  }

  /** Revoke a user's access to a tournament. */
  async revoke(params: { tournamentId: string; userEmail: string; providerId: string }, grantor: UserContext) {
    const { tournamentId, userEmail } = params;

    const owner = await this.owningProvider(tournamentId, params.providerId);
    if (owner.error) return { error: owner.error };

    if (!isProviderAdminFor(grantor, owner.providerId)) {
      return { error: INSUFFICIENT_PERMISSIONS };
    }

    const grantee = await this.userStorage.findOne(userEmail);
    if (!grantee) return { error: 'User not found' };
    const granteeUserId = grantee.userId ?? grantee.user_id;

    await this.assignmentStorage.revoke(tournamentId, granteeUserId);
    this.logger.log(`Revoked ${userEmail} access to ${tournamentId}`);

    return { success: true };
  }

  /** List users in a provider who are eligible to be granted access (for the manage-access UI autocomplete). */
  async eligibleUsers(params: { providerId: string }, grantor: UserContext) {
    const { providerId } = params;

    if (!isProviderAdminFor(grantor, providerId)) {
      return { error: 'Insufficient permissions' };
    }

    const rows = await this.userProviderStorage.findByProviderId(providerId);
    const users = rows.map((row) => ({
      userId: row.userId,
      email: row.email,
      providerRole: row.providerRole,
    }));

    return { success: true, users };
  }

  /** Resolve the set of tournament IDs a user has been explicitly granted access to. */
  async getAssignedTournamentIds(userId: string, providerId?: string): Promise<Set<string>> {
    return new Set((await this.getAssignedRoles(userId, providerId)).keys());
  }

  /**
   * Resolve tournamentId → `assignment_role` for a user's explicit grants.
   *
   * Mutation gates MUST use this rather than `getAssignedTournamentIds`: the id
   * set alone cannot distinguish a SCORER from a DIRECTOR, which is precisely
   * how granting SCORER used to confer full mutation rights.
   */
  async getAssignedRoles(userId: string, providerId?: string): Promise<Map<string, string>> {
    try {
      const rows = await this.assignmentStorage.findByUserId(userId, providerId);
      return new Map(rows.map((r) => [r.tournamentId, r.assignmentRole]));
    } catch {
      // LevelDB stub throws — graceful fallback to an empty map so
      // callers in the gateway don't crash on non-Postgres deployments
      return new Map();
    }
  }
}
