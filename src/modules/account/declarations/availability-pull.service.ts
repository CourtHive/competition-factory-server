/**
 * AvailabilityPullService — the TD-mediated availability pull (director-side,
 * audience: admin, gated by canMutateTournament). This is the ONE place CFS
 * touches player availability: it fetches the relevant participants'
 * availability from the declarations service, translates UNAVAILABLE days into
 * DO_NOT_SCHEDULE personRequests (factory helper), and applies them through the
 * existing executionQueue as a single low-frequency mutation.
 *
 * Mirrors RegistrationsService's admin half (assertAdminAccess +
 * runExecutionQueue). No high-frequency workload is added to the mutation path.
 */
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

import { AssignmentsService } from '../../factory/assignments.service';
import { AuditService } from '../../audit/audit.service';
import { AvailabilityPullSummary, buildAvailabilityMethods, enumerateDates, extractCanonicalPersonIds } from './availability-pull.helpers';
import { DeclarationsClient } from './declarations-client.service';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { canMutateTournament } from '../../factory/helpers/checkTournamentAccess';
import { executionQueue as runExecutionQueue } from '../../factory/functions/private/executionQueue';
import type { UserContext } from '../auth/decorators/user-context.decorator';

export interface AvailabilityPullContext {
  userContext: UserContext;
  tournamentId: string;
}

export type AvailabilityPullResult = AvailabilityPullSummary & { applied: boolean };

@Injectable()
export class AvailabilityPullService {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
    private readonly auditService: AuditService,
    private readonly declarationsClient: DeclarationsClient,
  ) {}

  async pull(ctx: AvailabilityPullContext): Promise<AvailabilityPullResult> {
    const { tournamentRecord } = await this.assertAdminAccess(ctx.userContext, ctx.tournamentId);

    const provider = tournamentRecord?.parentOrganisation?.organisationId;
    if (!provider) throw new BadRequestException('Tournament has no provider association');

    const personIds = extractCanonicalPersonIds(tournamentRecord);
    const dates = enumerateDates(tournamentRecord?.startDate, tournamentRecord?.endDate);

    const empty: AvailabilityPullResult = { personsWithRequests: 0, requestsAdded: 0, ifNeeded: {}, applied: false };
    if (!personIds.length || !dates.length) return empty;

    const snapshots = await this.declarationsClient.getAvailability(personIds, provider);
    const { methods, summary } = buildAvailabilityMethods({ snapshots, dates });
    if (!methods.length) return { ...summary, applied: false };

    const result: any = await runExecutionQueue(
      {
        tournamentIds: [ctx.tournamentId],
        methods,
        userId: ctx.userContext.userId,
        userEmail: ctx.userContext.email,
        source: 'availability-pull',
      },
      undefined,
      this.tournamentStorageService,
      this.auditService,
    );
    if (!result?.success) {
      const err = result?.error ?? 'addPersonRequests failed';
      throw new BadRequestException(typeof err === 'string' ? err : JSON.stringify(err));
    }

    return { ...summary, applied: true };
  }

  private async assertAdminAccess(
    userContext: UserContext | undefined,
    tournamentId: string,
  ): Promise<{ tournamentRecord: any }> {
    if (!userContext) throw new UnauthorizedException();
    if (!tournamentId) throw new BadRequestException('tournamentId is required');
    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) throw new BadRequestException('Tournament not found');
    const assignedRoles = await this.assignmentsService.getAssignedRoles(userContext.userId);
    if (!canMutateTournament(tournamentRecord, userContext, assignedRoles)) {
      throw new ForbiddenException('Not authorised to pull availability for this tournament');
    }
    return { tournamentRecord };
  }
}
