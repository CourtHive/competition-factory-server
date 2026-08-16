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
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { MutationMirrorService } from '../tournament-sync/mutation-mirror.service';
import { withTournamentLock } from 'src/services/tournamentMutex';
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
import { askEngine, factoryConstants, queryGovernor } from 'tods-competition-factory';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;
const EXISTING_POLICY_TYPE = factoryConstants.errorConditionConstants.EXISTING_POLICY_TYPE;

// types and interfaces
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import { TOURNAMENT_STORAGE, type ITournamentStorage, TOURNAMENT_PROVISIONER_STORAGE, type ITournamentProvisionerStorage, PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';

/**
 * Reduce a ScheduleCell to court occupancy only — no participant labels, round, event or matchUp
 * detail — for a coordination 'view' peer the caller can't author. Keeps the shared-facility view
 * opaque (INV: reserved cells reveal that a court/time is taken, never by whom).
 */
function opaqueReservedCell(cell: any) {
  return {
    tournamentId: cell?.tournamentId,
    venueId: cell?.venueId,
    courtId: cell?.courtId,
    courtOrder: cell?.courtOrder,
    scheduledDate: cell?.scheduledDate,
    scheduledTime: cell?.scheduledTime,
    access: 'view',
  };
}

@Injectable()
export class FactoryService {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly snapshotProjection: SnapshotProjectionService,
    private readonly mutationServices: MutationServicesService,
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
    // BUG FIX: this path previously forwarded the controller's bag verbatim,
    // which carried `{ cacheManager, trackCacheKey }` and NOTHING else — so
    // every REST and provisioner mutation ran with `services.projectionOutbox`
    // undefined and enqueued no read-model deltas. Silent: no error, no log,
    // no failing test; the read model simply never learned about those
    // mutations. Assembling through MutationServicesService here (rather than
    // at each controller) means every current and future REST caller gets the
    // server-owned services by construction.
    const result = await eq(
      { ...params },
      this.mutationServices.build(services ?? {}),
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

    const policy = computeEffectiveConfig(provider?.providerConfigCaps, provider?.providerConfigSettings)?.participantPrivacyPolicy;
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
      //
      // Services still come from the builder. This previously passed
      // `undefined`, which is the same divergence as the REST path had: a real
      // `attachPolicies` mutation that saved the record but enqueued no
      // read-model delta and emitted no telemetry. Bypassing this.executionQueue
      // for its error-handling must not also mean bypassing the services bag.
      const res: any = await eq(
        params,
        this.mutationServices.build(),
        this.tournamentStorageService,
        this.auditService,
        this.tournamentProvisionerStorage,
        this.providerStorage,
      ).catch((err) => ({ error: err?.message ?? String(err) }));

      // Factory error constants are objects ({ code, message }); the executionQueue
      // result surfaces the error as an object or a bare string. Normalise both to
      // a code for comparison.
      const existingCode = (EXISTING_POLICY_TYPE as any)?.code ?? EXISTING_POLICY_TYPE;
      const errorCode = res?.error?.code ?? res?.error;
      if (res?.success) attached.push(tournamentId);
      else if (errorCode === existingCode) alreadyAttached.push(tournamentId);
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
    return await setMatchUpStatus(
      params,
      // setMatchUpStatus forwards straight into executionQueue, so this needs
      // the full bag too — it previously passed `{ cacheManager }` alone, which
      // meant REST score submissions saved the record but produced no
      // read-model delta.
      this.mutationServices.build({ cacheManager }),
      this.tournamentStorageService,
      this.auditService,
      this.tournamentProvisionerStorage,
      this.providerStorage,
    );
  }

  async getMatchUps(params) {
    return await allTournamentMatchUps(params, this.tournamentStorage);
  }

  /**
   * Operational shared-facility schedule projection. Returns slim `ScheduleCell[]` (unpublished —
   * the factory transform applies no publish-state gating, per INV-6) for the requested tournaments
   * the caller is authorized to view, optionally filtered to `venueIds`.
   *
   * Reuses `fetchTournamentRecords` for the per-tournament `canViewTournament` gate; if any
   * requested id is filtered out (not viewable) the request is rejected rather than silently
   * returning a partial view. Not cached — the result is access-gated per user.
   */
  async getScheduleProjection(
    dto: { tournamentId?: string; tournamentIds?: string[]; venueIds?: string[] },
    user,
    userContext?: UserContext,
  ) {
    // Coordination view: given a context tournament the caller AUTHORS, return slim projections of
    // its server-verified linked peers — including peers the caller can't otherwise view (a
    // different director/provider sharing the facility). Peers the caller can also author come back
    // `access:'author'`; peers they can only coordinate around come back `access:'view'` and OPAQUE
    // (no participant/round detail — court occupancy only).
    if (dto?.tournamentId) return this.getCoordinationProjection(dto.tournamentId, dto.venueIds, user, userContext);

    // Legacy view-gated aggregation: slim cells for the requested tournaments the caller can view.
    const tournamentIds = dto?.tournamentIds;
    const venueIds = dto?.venueIds;
    if (!Array.isArray(tournamentIds) || !tournamentIds.length) return { error: 'Missing tournamentIds' };

    const fetchResult: any = await this.fetchTournamentRecords({ tournamentIds }, user, userContext);
    if (fetchResult.error) return fetchResult;

    const tournamentRecords = fetchResult.tournamentRecords ?? {};
    const viewableIds = Object.keys(tournamentRecords);
    const forbidden = tournamentIds.filter((tournamentId) => !viewableIds.includes(tournamentId));
    if (forbidden.length) return { error: 'User not allowed', forbiddenTournamentIds: forbidden };

    const scheduleCells: any[] = [];
    for (const tournamentId of viewableIds) {
      const projection: any = queryGovernor.getScheduleProjection({
        tournamentRecord: tournamentRecords[tournamentId],
        venueIds,
      });
      if (projection?.scheduleCells) scheduleCells.push(...projection.scheduleCells);
    }
    return { scheduleCells };
  }

  private async getCoordinationProjection(contextId: string, venueIds, user, userContext?: UserContext) {
    // The context tournament must be view-gated (caller sees it) AND authorable (caller runs it).
    const ctxFetch: any = await this.fetchTournamentRecords({ tournamentIds: [contextId] }, user, userContext);
    if (ctxFetch.error) return ctxFetch;
    const context = ctxFetch.tournamentRecords?.[contextId];
    if (!context) return { error: 'User not allowed' };

    const assignedIds = userContext
      ? await this.assignmentsService.getAssignedTournamentIds(userContext.userId)
      : new Set<string>();
    if (!canMutateTournament(context, userContext, assignedIds)) return { error: 'User not allowed' };

    // Peers come from the context's SERVER-STORED links (set via the access-controlled linkTournaments
    // mutation) — the caller can't inject arbitrary ids to widen what they see.
    const peerIds = (context.linkedTournamentIds ?? []).filter((id: string) => id && id !== contextId);
    if (!peerIds.length) return { scheduleCells: [] };

    // Fetch peers WITHOUT the view gate — that is the coordination grant. Bounded by the authored
    // context's links, and view peers are returned opaque.
    const peerFetch: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentIds: peerIds });
    const peerRecords = peerFetch?.tournamentRecords ?? {};

    const scheduleCells: any[] = [];
    for (const peerId of Object.keys(peerRecords)) {
      const access = canMutateTournament(peerRecords[peerId], userContext, assignedIds) ? 'author' : 'view';
      const projection: any = queryGovernor.getScheduleProjection({ tournamentRecord: peerRecords[peerId], venueIds });
      // `author` cells carry the peer's tournamentName so the client can label which of the
      // caller's OWN linked tournaments holds a court. Deliberately NOT added to `view` cells:
      // those stay routed through opaqueReservedCell, preserving the invariant that a reserved
      // cell reveals a court is taken, never by whom.
      const tournamentName = peerRecords[peerId]?.tournamentName;
      for (const cell of projection?.scheduleCells ?? []) {
        scheduleCells.push(access === 'view' ? opaqueReservedCell(cell) : { ...cell, access, tournamentName });
      }
    }
    return { scheduleCells };
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
    // A generated record is a wholesale write too. The purge is a no-op for a
    // genuinely new tournamentId, but the upserts are how the read model learns
    // the tournament exists at all — today it learns nothing. Locked for the
    // same reason as /factory/save: a caller may pin an existing tournamentId
    // via tournamentAttributes, which makes this a replace.
    await withTournamentLock(Object.keys(tournamentRecords), async () => {
      const saveResult = await this.tournamentStorageService.saveTournamentRecords({
        tournamentRecords,
        projectionMode: 'snapshot',
        userId,
      });
      if (saveResult?.success) {
        await this.snapshotProjection.enqueueSnapshots({ tournamentRecords, source: 'factory-generate' });
      }
      return saveResult;
    });

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
    //
    // LOCKED, unlike before. This path replaces the whole record, so without the
    // per-tournament lock it interleaves with an in-flight executionQueue
    // mutation and silently discards it — the same lost-update class owner_epoch
    // guards against between processes, but reachable today within one. Skipping
    // executionQueue for immediacy was deliberate; skipping the lock was not.
    //
    // The lock is taken HERE and never in TournamentStorageService:
    // executionQueue calls that facade from INSIDE the lock and the mutex is not
    // reentrant, so locking at the facade would deadlock every mutation until
    // the 30s timeout.
    const userId = userContext?.userId ?? user?.userId;
    const savedIds = Object.keys(tournamentRecords);
    const result = await withTournamentLock(savedIds, async () => {
      const saveResult = await this.tournamentStorageService.saveTournamentRecords({
        tournamentRecords,
        projectionMode: 'snapshot',
        userId,
      });
      if (!saveResult?.success) return saveResult;

      // Post-commit, still inside the lock — the same seam executionQueue uses
      // for its delta flush. A wholesale replace raises no factory notices, so
      // the read model only learns about it through this snapshot span.
      await this.snapshotProjection.enqueueSnapshots({ tournamentRecords, source: 'factory-save' });
      return saveResult;
    });

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
    // Accepting a pending save writes the whole record — same wholesale-replace
    // semantics, same lock and snapshot requirements as /factory/save.
    const tournamentRecords = { [tournamentId]: data };
    const result = await withTournamentLock([tournamentId], async () => {
      const saveResult = await this.tournamentStorageService.saveTournamentRecords({
        tournamentRecords,
        projectionMode: 'snapshot',
      });
      if (saveResult?.success) {
        await this.snapshotProjection.enqueueSnapshots({ tournamentRecords, source: 'commit-save' });
      }
      return saveResult;
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
