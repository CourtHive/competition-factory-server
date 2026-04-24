import { generateTournamentRecord as gen } from './helpers/generateTournamentRecord';
import { canViewTournament, canMutateTournament } from './helpers/checkTournamentAccess';
import { queryTournamentRecords } from './functions/private/queryTournamentRecords';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { allTournamentMatchUps } from './functions/private/allTournamentMatchUps';
import { executionQueue as eq } from './functions/private/executionQueue';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { setMatchUpStatus } from './functions/private/setMatchUpStatus';
import { insertPendingSave, getPendingSaveStatus, getPendingSaveData, updatePendingSaveStatus } from './helpers/pendingSaves';
import { MutationMirrorService } from '../tournament-sync/mutation-mirror.service';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { checkEngineError } from '../../common/errors/engineError';
import { AssignmentsService } from './assignments.service';
import { AuditService } from '../audit/audit.service';
import { checkProvider } from './helpers/checkProvider';
import { askEngine } from 'tods-competition-factory';
import { Inject, Injectable, Optional, Logger } from '@nestjs/common';
import { checkUser } from './helpers/checkUser';
import publicQueries from './functions/public';

// types and interfaces
import type { UserContext } from 'src/modules/auth/decorators/user-context.decorator';
import { TOURNAMENT_STORAGE, type ITournamentStorage, TOURNAMENT_PROVISIONER_STORAGE, type ITournamentProvisionerStorage } from 'src/storage/interfaces';

@Injectable()
export class FactoryService {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
    private readonly auditService: AuditService,
    @Inject(TOURNAMENT_STORAGE) private readonly tournamentStorage: ITournamentStorage,
    @Inject(TOURNAMENT_PROVISIONER_STORAGE) private readonly tournamentProvisionerStorage: ITournamentProvisionerStorage,
    @Inject(PG_POOL) private readonly pgPool: any,
    @Optional() private readonly mutationMirror?: MutationMirrorService,
  ) {}

  getVersion(): any {
    const version = askEngine.version();
    return { version };
  }

  async executionQueue(params, services) {
    const result = await eq(params, services, this.tournamentStorageService, this.auditService, this.tournamentProvisionerStorage);
    checkEngineError(result);

    // Fire-and-forget: mirror successful mutations to upstream
    if (result?.success && this.mutationMirror) {
      const tournamentIds = params?.tournamentIds || (params?.tournamentId && [params.tournamentId]) || [];
      const methods = params?.methods ?? params?.executionQueue ?? [];
      this.mutationMirror.enqueue({ tournamentIds, methods }).catch((err) =>
        Logger.error(`Mutation mirror enqueue failed: ${err.message}`, 'FactoryService'),
      );
    }

    return result;
  }

  async score(params, cacheManager) {
    return await setMatchUpStatus(params, { cacheManager }, this.tournamentStorageService);
  }

  async getMatchUps(params) {
    return await allTournamentMatchUps(params, this.tournamentStorage);
  }

  async fetchTournamentRecords(params, user, userContext?: UserContext) {
    const validUser = checkUser({ user }); // don't attempt fetch if user is not allowed
    if (!validUser) return { error: 'Invalid user' };
    const result: any = await this.tournamentStorageService.fetchTournamentRecords(params);
    if (result.error) return result;

    // Provider-level gate (legacy — always active)
    const allowUser = checkProvider({ ...result, user, userContext });
    if (!allowUser) return { error: 'User not allowed' };

    // Per-tournament visibility gate (behind feature flag via canViewTournament)
    if (userContext && result.tournamentRecords) {
      const assignedIds = await this.assignmentsService.getAssignedTournamentIds(userContext.userId);
      for (const tid of Object.keys(result.tournamentRecords)) {
        if (!canViewTournament(result.tournamentRecords[tid], userContext, assignedIds)) {
          delete result.tournamentRecords[tid];
        }
      }
    }

    return result;
  }

  async generateTournamentRecord(params, user, userContext?: UserContext) {
    const validUser = checkUser({ user });
    if (!validUser) return { error: 'Invalid user' };
    const { tournamentRecord, tournamentRecords } = await gen(params, user);
    const userId = userContext?.userId;
    this.tournamentStorageService.saveTournamentRecords({ tournamentRecords, userId });
    return { tournamentRecord, success: true };
  }

  async queryTournamentRecords(params) {
    return await queryTournamentRecords(params, this.tournamentStorage);
  }

  async removeTournamentRecords(params, user) {
    return await this.tournamentStorageService.removeTournamentRecords(params, user, this.auditService);
  }

  async saveTournamentRecords(params, user, userContext?: UserContext) {
    const validUser = checkUser({ user });
    if (!validUser) return { error: 'Invalid user' };
    const tournamentRecords = getTournamentRecords(params);
    const allowUser = checkProvider({ tournamentRecords, user, userContext });
    if (!allowUser) return { error: 'User not allowed' };

    // Per-tournament mutation gate
    if (userContext) {
      const assignedIds = await this.assignmentsService.getAssignedTournamentIds(userContext.userId);
      for (const tid of Object.keys(tournamentRecords)) {
        if (!canMutateTournament(tournamentRecords[tid], userContext, assignedIds)) {
          return { error: `User not allowed to modify tournament ${tid}` };
        }
      }
    }

    // Save directly — tournament must be available immediately for
    // subsequent executionQueue mutations from the client.
    const userId = userContext?.userId ?? user?.userId;
    const result = await this.tournamentStorageService.saveTournamentRecords({ tournamentRecords, userId });

    // Additionally queue for async validation if requested
    if (params.validate) {
      const validationLevel = params.validate === 'deep' ? 'L3' : 'L2';
      for (const tid of Object.keys(tournamentRecords)) {
        insertPendingSave(this.pgPool, {
          tournamentId: tid,
          tournamentData: tournamentRecords[tid],
          userId: userContext?.userId,
          userEmail: user?.email,
          providerId: user?.providerId,
          validationLevel,
        }).catch((err) => Logger.error(`Failed to queue validation for ${tid}: ${err.message}`, 'FactoryService'));
      }
    }

    return result;
  }

  async getSaveStatus(saveId: string) {
    return await getPendingSaveStatus(this.pgPool, saveId);
  }

  async commitSave(saveId: string) {
    const data = await getPendingSaveData(this.pgPool, saveId);
    if (!data) return { error: 'Save not found' };

    const tournamentId = data.tournamentId;
    const result = await this.tournamentStorageService.saveTournamentRecords({
      tournamentRecords: { [tournamentId]: data },
    });

    await updatePendingSaveStatus(this.pgPool, saveId, 'accepted');
    return result;
  }

  async getAssistantContext({ tournamentId }: { tournamentId: string }) {
    return await publicQueries.getAssistantContext({ tournamentId }, this.tournamentStorage);
  }

  async getTournamentInfo({
    tournamentId,
    withMatchUpStats,
    withStructureDetails,
    usePublishState,
    withVenueData,
  }: {
    tournamentId: string;
    withMatchUpStats?: boolean;
    withStructureDetails?: boolean;
    usePublishState?: boolean;
    withVenueData?: boolean;
  }) {
    return await publicQueries.getTournamentInfo(
      { tournamentId, withMatchUpStats, withStructureDetails, usePublishState, withVenueData },
      this.tournamentStorage,
    );
  }

  async getEventData({
    hydrateParticipants,
    tournamentId,
    eventId,
  }: {
    hydrateParticipants?: boolean;
    tournamentId: string;
    eventId: string;
  }) {
    return await publicQueries.getEventData({ hydrateParticipants, tournamentId, eventId }, this.tournamentStorage);
  }

  async getScheduleMatchUps({ params }) {
    return await publicQueries.getCompetitionScheduleMatchUps(params, this.tournamentStorage);
  }

  async getParticipants({ params }) {
    return await publicQueries.getParticipants(params, this.tournamentStorage);
  }
}
