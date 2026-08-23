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
import { canMutateTournament } from './helpers/checkTournamentAccess';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { AssignmentsService } from './assignments.service';
import { Inject, Injectable, Logger } from '@nestjs/common';

export type MutationGateParams = {
  userContext: any;
  tournamentIds: string[];
  /** Factory mutation method names, in payload order. */
  requestedMethods: string[];
  /** Identity used for the denial log line only. */
  actor?: string;
};

@Injectable()
export class MutationAuthorizationService {
  private readonly logger = new Logger(MutationAuthorizationService.name);

  constructor(
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
  ) {}

  /**
   * Returns the denial reason when any tournament rejects, or `null` when all
   * clear. Super-admins bypass the provider-permission gate (but not the
   * per-tournament gate, which returns early for them anyway).
   */
  async gate({ userContext, tournamentIds, requestedMethods, actor }: MutationGateParams): Promise<string | null> {
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
