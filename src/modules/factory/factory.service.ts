import { generateTournamentRecord as gen } from './helpers/generateTournamentRecord';
import { canViewTournament, canMutateTournament } from './helpers/checkTournamentAccess';
import { queryTournamentRecords } from './functions/private/queryTournamentRecords';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { allTournamentMatchUps } from './functions/private/allTournamentMatchUps';
import { executionQueue as eq } from './functions/private/executionQueue';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { setMatchUpStatus } from './functions/private/setMatchUpStatus';
import { insertPendingSave, getPendingSaveStatus, getPendingSaveData, updatePendingSaveStatus } from './helpers/pendingSaves';
import { validateL2 } from './helpers/validateTournamentRecord';
import { MutationMirrorService } from '../tournament-sync/mutation-mirror.service';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { checkEngineError } from '../../common/errors/engineError';
import { AssignmentsService } from './assignments.service';
import { AuditService } from '../audit/audit.service';
import { checkProvider } from './helpers/checkProvider';
import { attachProviderPrivacyOnCreate } from './helpers/attachProviderPrivacyOnCreate';
import { selectPrivacyApplyTargets } from './helpers/selectPrivacyApplyTargets';
import { BadRequestException, Inject, Injectable, Optional, Logger } from '@nestjs/common';
import { computeEffectiveConfig } from '@courthive/provider-config';
import { checkUser } from './helpers/checkUser';
import publicQueries from './functions/public';
import { askEngine, factoryConstants } from 'tods-competition-factory';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;
const EXISTING_POLICY_TYPE = factoryConstants.errorConditionConstants.EXISTING_POLICY_TYPE;

// types and interfaces
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import { TOURNAMENT_STORAGE, type ITournamentStorage, TOURNAMENT_PROVISIONER_STORAGE, type ITournamentProvisionerStorage, PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';

@Injectable()
export class FactoryService {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
    private readonly auditService: AuditService,
    @Inject(TOURNAMENT_STORAGE) private readonly tournamentStorage: ITournamentStorage,
    @Inject(TOURNAMENT_PROVISIONER_STORAGE) private readonly tournamentProvisionerStorage: ITournamentProvisionerStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(PG_POOL) private readonly pgPool: any,
    @Optional() private readonly mutationMirror?: MutationMirrorService,
  ) {}

  getVersion(): any {
    const version = askEngine.version();
    return { version };
  }

  async executionQueue(params, services) {
    const result = await eq(
      params,
      services,
      this.tournamentStorageService,
      this.auditService,
      this.tournamentProvisionerStorage,
      this.providerStorage,
    );
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

  /**
   * Apply the provider's selected participant-privacy policy to its EXISTING
   * tournaments. UPCOMING tournaments are always targeted; IN-PROGRESS ones
   * only when `includeInProgress` is set; COMPLETED tournaments are never
   * touched (confirmed decision — never force a privacy change on a finished
   * event). Each attach runs through the full executionQueue mutation path
   * (per-tournament lock + save + audit + broadcast); `attachPolicies` is
   * idempotent, so a tournament that already carries the policy is reported
   * as `alreadyAttached` rather than re-written.
   */
  async applyParticipantPrivacyToExisting(
    { providerId, includeInProgress }: { providerId: string; includeInProgress?: boolean },
    userContext?: UserContext,
  ) {
    const provider: any = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found' };

    const policy = computeEffectiveConfig(provider?.caps, provider?.settings)?.participantPrivacyPolicy;
    if (!policy || !Object.keys(policy).length) {
      return { error: 'NO_PRIVACY_POLICY', policyConfigured: false };
    }

    const tournaments = await this.tournamentStorageService.listProviderTournaments({ providerId });
    const today = new Date().toISOString().split('T')[0];
    const targets = selectPrivacyApplyTargets(tournaments, { includeInProgress: !!includeInProgress, today });

    const attached: string[] = [];
    const alreadyAttached: string[] = [];
    const failed: Array<{ tournamentId: string; error: any }> = [];

    for (const tournamentId of targets.selected) {
      const params = {
        methods: [{ method: 'attachPolicies', params: { policyDefinitions: { [POLICY_TYPE_PARTICIPANT]: policy }, tournamentId } }],
        tournamentIds: [tournamentId],
        userId: userContext?.userId,
        source: 'ams-apply-privacy',
      };
      // Call the private mutation path directly (not this.executionQueue) so a
      // per-tournament EXISTING_POLICY_TYPE result is inspected, not thrown by
      // checkEngineError.
      const res: any = await eq(
        params,
        undefined,
        this.tournamentStorageService,
        this.auditService,
        this.tournamentProvisionerStorage,
        this.providerStorage,
      ).catch((err) => ({ error: err?.message ?? String(err) }));

      const errorCode = res?.error?.code ?? res?.error;
      if (res?.success) attached.push(tournamentId);
      else if (errorCode === EXISTING_POLICY_TYPE) alreadyAttached.push(tournamentId);
      else failed.push({ tournamentId, error: errorCode ?? 'attach failed' });
    }

    return {
      success: true,
      policyConfigured: true,
      attached,
      alreadyAttached,
      failed,
      counts: {
        upcoming: targets.upcoming.length,
        inProgress: targets.inProgress.length,
        completed: targets.completed.length,
        selected: targets.selected.length,
      },
    };
  }

  async score(params, cacheManager) {
    return await setMatchUpStatus(params, { cacheManager }, this.tournamentStorageService);
  }

  async getMatchUps(params) {
    return await allTournamentMatchUps(params, this.tournamentStorage);
  }

  async fetchTournamentRecords(params, user, userContext?: UserContext) {
    const validUser = checkUser({ user, userContext }); // don't attempt fetch if user is not allowed
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

  // Lightweight staleness probe — returns only `updatedAt`, never the full
  // record. Reuses the exact same access gates as `fetchTournamentRecords`,
  // run against a minimal record projected from the JSONB, so the probe can't
  // leak a timestamp for a tournament the user couldn't otherwise fetch.
  async fetchTournamentUpdatedAt(params: { tournamentId?: string }, user, userContext?: UserContext) {
    const validUser = checkUser({ user, userContext });
    if (!validUser) return { error: 'Invalid user' };

    const { tournamentId } = params;
    if (!tournamentId) return { error: 'Missing tournamentId' };

    const result: any = await this.tournamentStorageService.fetchTournamentUpdatedAt({ tournamentId });
    if (result.error) return result;

    const minimalRecord = {
      parentOrganisation: result.providerId ? { organisationId: result.providerId } : undefined,
      extensions: result.extensions ?? [],
      updatedAt: result.updatedAt,
    };
    const tournamentRecords = { [tournamentId]: minimalRecord };

    const allowUser = checkProvider({ tournamentRecords, user, userContext });
    if (!allowUser) return { error: 'User not allowed' };

    if (userContext) {
      const assignedIds = await this.assignmentsService.getAssignedTournamentIds(userContext.userId);
      if (!canViewTournament(minimalRecord, userContext, assignedIds)) {
        return { error: 'User not allowed' };
      }
    }

    return { success: true, tournamentId, updatedAt: result.updatedAt };
  }

  async generateTournamentRecord(
    params,
    user,
    userContext?: UserContext,
    provisionerContext?: { provisionerId: string; providerId?: string; provisionerName?: string },
  ) {
    const validUser = checkUser({ user, userContext });
    if (!validUser) return { error: 'Invalid user' };
    const { tournamentRecord, tournamentRecords } = await gen(params, user);

    // Provisioner-origin extension on parentOrganisation. Matches the shape
    // stamped by executionQueue.ts:166-184 for newTournamentRecord mutations,
    // so the audit trail looks identical regardless of which create path
    // a provisioner uses.
    if (provisionerContext?.provisionerId && tournamentRecord?.parentOrganisation) {
      const extensions = tournamentRecord.parentOrganisation.extensions ?? [];
      const ext = {
        name: 'provisionerOrigin',
        value: {
          provisionerId: provisionerContext.provisionerId,
          provisionerName: provisionerContext.provisionerName,
          createdAt: new Date().toISOString(),
        },
      };
      const idx = extensions.findIndex((e: any) => e?.name === 'provisionerOrigin');
      if (idx >= 0) extensions[idx] = ext;
      else extensions.push(ext);
      tournamentRecord.parentOrganisation.extensions = extensions;
    }

    // Await the save. The previous fire-and-forget pattern returned success
    // before the row hit storage, which let provisioners observe an empty
    // calendar immediately after a 200, and obscured storage failures behind
    // a misleading success envelope (caught 2026-05-29 via the
    // provisioner-mismatched-providerid e2e test).
    const userId = userContext?.userId;
    await this.tournamentStorageService.saveTournamentRecords({ tournamentRecords, userId });

    // Provisioner ownership stamp — fail-soft, same policy as the
    // executionQueue path (executionQueue.ts:161). The tournament exists
    // either way; the row is metadata for audit + multi-tenant queries.
    if (provisionerContext?.provisionerId && provisionerContext?.providerId && tournamentRecord?.tournamentId) {
      this.tournamentProvisionerStorage
        .create({
          tournamentId: tournamentRecord.tournamentId,
          provisionerId: provisionerContext.provisionerId,
          providerId: provisionerContext.providerId,
        })
        .catch((err: Error) =>
          Logger.error(
            `Provisioner stamp failed for ${tournamentRecord.tournamentId}: ${err.message}`,
            'FactoryService',
          ),
        );
    }

    return { tournamentRecord, success: true };
  }

  async queryTournamentRecords(params) {
    return await queryTournamentRecords(params, this.tournamentStorage);
  }

  async removeTournamentRecords(params, user, userContext?: UserContext) {
    return await this.tournamentStorageService.removeTournamentRecords(
      params,
      user,
      this.auditService,
      userContext,
    );
  }

  async saveTournamentRecords(params, user, userContext?: UserContext) {
    const validUser = checkUser({ user, userContext });
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

    // PRIVACY ATTACH (creation only): on the first save of a provider-owned
    // tournament (the TMX UI create path — sendTournament → /factory/save),
    // attach the provider's selected participant-privacy policy so public
    // reads (getParticipants) honor it. Mirrors the executionQueue create
    // hook for the API/provisioner path. Runs before validation so the
    // attached extension is validated too. Fail-soft.
    for (const record of Object.values(tournamentRecords)) {
      await attachProviderPrivacyOnCreate(record, {
        tournamentStorageService: this.tournamentStorageService,
        providerStorage: this.providerStorage,
      }).catch((err) => Logger.error(`Privacy attach on save failed: ${err.message}`, 'FactoryService'));
    }

    // L2 validation gate. Records under the byte threshold are validated
    // synchronously and rejected on failure; over-threshold records are
    // saved as-is and an async L2 is queued via pending_saves so the
    // event loop is never blocked by a deep-copy of a multi-MB record.
    const threshold = this.getValidationThresholdBytes();
    const oversized: string[] = [];
    for (const [tid, record] of Object.entries(tournamentRecords)) {
      const size = Buffer.byteLength(JSON.stringify(record));
      if (size > threshold) {
        oversized.push(tid);
        continue;
      }
      const result = validateL2(record);
      if (!result.valid) {
        throw new BadRequestException({
          error: `Tournament record ${tid} failed validation`,
          tournamentId: tid,
          validationErrors: result.errors,
          validationWarnings: result.warnings ?? [],
        });
      }
    }

    // Save directly — tournament must be available immediately for
    // subsequent executionQueue mutations from the client.
    const userId = userContext?.userId ?? user?.userId;
    const result = await this.tournamentStorageService.saveTournamentRecords({ tournamentRecords, userId });

    // For oversized records, queue an async L2 pass so the validation
    // result is still discoverable post-hoc via /factory/save-status.
    for (const tid of oversized) {
      insertPendingSave(this.pgPool, {
        tournamentId: tid,
        tournamentData: tournamentRecords[tid],
        userId: userContext?.userId,
        userEmail: user?.email,
        providerId: user?.providerId,
        validationLevel: 'L2',
      }).catch((err) => Logger.error(`Failed to queue validation for ${tid}: ${err.message}`, 'FactoryService'));
    }

    return result;
  }

  private getValidationThresholdBytes(): number {
    const raw = process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isNaN(parsed) || parsed < 1 ? 1_048_576 : parsed;
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
    return await publicQueries.getParticipants(params, this.tournamentStorage, this.providerStorage);
  }
}
