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
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import type { UserContext } from '../auth/decorators/user-context.decorator';

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    @Inject(ASSIGNMENT_STORAGE) private readonly assignmentStorage: IAssignmentStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
  ) {}

  /** List assignments for a tournament, or all assignments for the requesting user. */
  async list(params: { tournamentId?: string }, userContext: UserContext) {
    if (params.tournamentId) {
      return { success: true, assignments: await this.assignmentStorage.findByTournamentId(params.tournamentId) };
    }
    return { success: true, assignments: await this.assignmentStorage.findByUserId(userContext.userId) };
  }

  /** Grant a user access to a tournament. Validates grantor role and grantee provider membership. */
  async grant(
    params: { tournamentId: string; userEmail: string; providerId: string; role?: string },
    grantor: UserContext,
  ) {
    const { tournamentId, userEmail, providerId, role } = params;

    // Grantor must be PROVIDER_ADMIN for this provider or SUPER_ADMIN
    if (!grantor.isSuperAdmin && grantor.providerRoles[providerId] !== PROVIDER_ADMIN) {
      return { error: 'Insufficient permissions — must be PROVIDER_ADMIN or SUPER_ADMIN' };
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
    const { tournamentId, userEmail, providerId } = params;

    if (!grantor.isSuperAdmin && grantor.providerRoles[providerId] !== PROVIDER_ADMIN) {
      return { error: 'Insufficient permissions — must be PROVIDER_ADMIN or SUPER_ADMIN' };
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

    if (!grantor.isSuperAdmin && grantor.providerRoles[providerId] !== PROVIDER_ADMIN) {
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
    try {
      const rows = await this.assignmentStorage.findByUserId(userId, providerId);
      return new Set(rows.map((r) => r.tournamentId));
    } catch {
      // LevelDB stub throws — graceful fallback to empty set so
      // callers in the gateway don't crash on non-Postgres deployments
      return new Set();
    }
  }
}
