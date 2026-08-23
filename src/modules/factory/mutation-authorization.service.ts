/**
 * The single mutation-authorization gate, shared by every transport.
 *
 * Both the Socket.IO `executionQueue` handler and the REST `POST /factory`
 * route must apply the same two gates before a mutation reaches the engine:
 *
 *   1. `canMutateTournament` — per-tournament access, including the
 *      assignment_role classification (OBSERVER cannot mutate, SCORER is
 *      limited to scoring methods).
 *   2. the owning provider's `MUTATION_PERMISSIONS` map.
 *
 * This lives in one function that every transport calls, per architectural
 * standard A10 ("keep the merge in one function that every implementation of
 * the transport calls"). It exists because the REST path previously applied
 * NEITHER gate: any authenticated CLIENT could post the same `methods` array
 * over HTTP and bypass both per-tournament access and every provider
 * permission the socket path enforces.
 *
 * Provided directly by both FactoryModule and TmxModule rather than exported
 * from one and imported by the other — the same pattern (and for the same
 * reason) as AssignmentsService: importing FactoryModule into MessagingModule
 * would create a circular module dependency. Its own DI deps come from the
 * @Global StorageModule.
 */
import { computeEffectiveConfig, isMutationAllowed } from '@courthive/provider-config';
import { enrichTargetFromRecord, targetFromParams } from './helpers/resolveMutationTarget';
import { isTargetInScope, isWithinWindow, requiredTargetKeys } from './helpers/grantScope';
import { canMutateTournament } from './helpers/checkTournamentAccess';
import { GRANT_STORAGE, type IGrantStorage } from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { AssignmentsService } from './assignments.service';
import { Inject, Injectable, Logger } from '@nestjs/common';

export type MutationGateParams = {
  userContext: any;
  tournamentIds: string[];
  /** Factory mutation method names, in payload order. */
  requestedMethods: string[];
  /**
   * The full method objects, params included. Required for scope evaluation —
   * the method NAME alone cannot say which matchUp is being scored, which is
   * exactly why a name-only gate could never express "may score on Court 7".
   * Optional so callers that only need the coarse gates need not supply it.
   */
  methods?: { method?: string; params?: any }[];
  /** Identity used for the denial log line only. */
  actor?: string;
};

@Injectable()
export class MutationAuthorizationService {
  private readonly logger = new Logger(MutationAuthorizationService.name);

  constructor(
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(GRANT_STORAGE) private readonly grantStorage: IGrantStorage,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
  ) {}

  /**
   * Returns the denial reason when any tournament rejects, or `null` when all
   * clear. Super-admins bypass the provider-permission gate (but not the
   * per-tournament gate, which returns early for them anyway).
   */
  async gate({ userContext, tournamentIds, requestedMethods, methods, actor }: MutationGateParams): Promise<string | null> {
    if (!userContext || !tournamentIds.length) return null;

    const assignedRoles = await this.assignmentsService.getAssignedRoles(userContext.userId);
    const methodSummary = requestedMethods.join('|');

    for (const tid of tournamentIds) {
      const result: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentId: tid });
      const tournament = result?.tournamentRecords?.[tid];
      if (!tournament) continue;

      if (!canMutateTournament(tournament, userContext, assignedRoles, requestedMethods)) {
        this.logger.warn(`[executionQueue] mutation denied for ${actor}: ${methodSummary} on ${tid}`);
        return 'Not authorized to modify this tournament';
      }

      const outOfScope = await this.checkGrantScope(tournament, userContext, methods ?? []);
      if (outOfScope) {
        this.logger.warn(
          `[executionQueue] out of granted scope for ${actor}: ${outOfScope.method} on ${tid}`,
        );
        return `Not authorized for this ${outOfScope.dimension}`;
      }

      if (userContext.isSuperAdmin || !requestedMethods.length) continue;
      const blocked = await this.checkProviderPermissionGate(tournament, requestedMethods);
      if (blocked) {
        this.logger.warn(
          `[executionQueue] provider permission denied for ${actor}: ${blocked.method} on ${tid} (provider ${blocked.providerId})`,
        );
        return `Action not permitted: ${blocked.method}`;
      }
    }
    return null;
  }

  /**
   * Scoped grants narrow what an already-authorized user may touch.
   *
   * Returns the first method that falls outside every grant, or null.
   *
   * A subject with NO grant rows is unrestricted here — this table is additive,
   * so nothing changes until someone writes a scoped row. A subject WITH grants
   * must have at least one that is live and covers the target: holding a
   * Court-7 grant is a statement about where you may work, so a mutation
   * elsewhere is refused even though the coarse gates passed.
   */
  private async checkGrantScope(
    tournament: any,
    userContext: any,
    methods: { method?: string; params?: any }[],
  ): Promise<{ method: string; dimension: string } | null> {
    if (userContext.isSuperAdmin || !methods.length) return null;
    const tournamentId = tournament?.tournamentId;
    if (!tournamentId || !userContext.userId) return null;

    let grants;
    try {
      grants = await this.grantStorage.findForSubject(userContext.userId, tournamentId);
    } catch {
      // Storage unavailable (non-Postgres deployment) — fall through to the
      // coarse gates rather than denying every mutation.
      return null;
    }
    if (!grants.length) return null; // no scoped grants → unrestricted here

    const live = grants.filter((grant) => isWithinWindow(grant));
    if (!live.length) return { method: methods[0]?.method ?? 'unknown', dimension: 'time window' };

    for (const method of methods) {
      let target = targetFromParams(method);
      const needed = live.flatMap((grant) => requiredTargetKeys(grant.scope));
      if (needed.length) target = enrichTargetFromRecord(target, tournament, needed);

      const covered = live.some((grant) => isTargetInScope(grant.scope, target));
      if (!covered) {
        const dimension = requiredTargetKeys(live[0].scope)[0] ?? 'scope';
        return { method: method?.method ?? 'unknown', dimension };
      }
    }
    return null;
  }

  /** Returns the first method blocked by the owning provider's permissions, or null. */
  private async checkProviderPermissionGate(
    tournament: any,
    requestedMethods: string[],
  ): Promise<{ method: string; providerId: string } | null> {
    const providerId = tournament?.parentOrganisation?.organisationId;
    if (!providerId) return null;
    const provider: any = await this.providerStorage.getProvider(providerId);
    const effective = computeEffectiveConfig(
      provider?.providerConfigCaps ?? {},
      provider?.providerConfigSettings ?? {},
    );
    const permissions = effective.permissions ?? {};
    const method = requestedMethods.find((m) => !isMutationAllowed(m, permissions));
    return method ? { method, providerId } : null;
  }
}
