import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  BOLT_HISTORY_REPORTING,
  IBoltHistoryReporting,
  PlayerPointStats,
  TournamentLeader,
} from 'src/storage/interfaces/bolt-history-reporting.interface';
import {
  BOLT_HISTORY_STORAGE,
  BoltHistoryDocument,
  IBoltHistoryStorage,
} from 'src/storage/interfaces/bolt-history.interface';
import { OutboundQueueService } from 'src/modules/relay/outbound-queue.service';
import { TournamentBroadcastService } from 'src/modules/messaging/broadcast/tournament-broadcast.service';
import { ProjectorService } from 'src/modules/projectors/projector.service';
import { FactoryService } from 'src/modules/factory/factory.service';
import { RelayConfig } from 'src/modules/relay/relay.config';

@Injectable()
export class BoltHistoryService {
  private readonly logger = new Logger(BoltHistoryService.name);

  constructor(
    @Inject(BOLT_HISTORY_STORAGE) private readonly storage: IBoltHistoryStorage,
    @Inject(BOLT_HISTORY_REPORTING) private readonly reporting: IBoltHistoryReporting,
    private readonly projector: ProjectorService,
    private readonly broadcast: TournamentBroadcastService,
    private readonly relayConfig: RelayConfig,
    private readonly factoryService: FactoryService,
    @Optional() private readonly outboundQueue?: OutboundQueueService,
  ) {}

  /**
   * Fetch the parent team matchUp for a given tieMatchUpId.
   *
   * Used by the fully-fresh-device hydration path: when a scorekeeper
   * opens BoltScoringPage on a device that has no localStorage and no
   * prior navigation through TMX, the client has nothing but the URL's
   * tieMatchUpId. This endpoint resolves that to the full parent team
   * matchUp so the client can populate its store and then apply the
   * bolt-history document on top.
   *
   * Flow:
   *   1. Look up the bolt-history document → tournamentId + parentMatchUpId
   *   2. Use FactoryService.getMatchUps with a single-id filter
   *   3. Return the first match (or NOT_FOUND)
   */
  async getParentMatchUp(
    tieMatchUpId: string,
  ): Promise<{ teamMatchUp?: any; error?: string }> {
    if (!tieMatchUpId) return { error: 'tieMatchUpId required' };

    const found = await this.storage.findBoltHistory({ tieMatchUpId });
    if (found.error || !found.document) {
      return { error: found.error ?? 'Bolt history not found' };
    }
    const { tournamentId, parentMatchUpId } = found.document;
    if (!tournamentId || !parentMatchUpId) {
      return { error: 'Bolt history document missing tournamentId or parentMatchUpId' };
    }

    try {
      const result: any = await this.factoryService.getMatchUps({
        tournamentId,
        matchUpFilters: { matchUpIds: [parentMatchUpId] },
      });
      if (result?.error) return { error: result.error };

      // queryEngine.allTournamentMatchUps returns an object with shape
      // { matchUps: [...] } or similar — drill in defensively.
      const matchUps: any[] =
        result?.matchUps ?? result?.completedMatchUps ?? [];
      const upcoming: any[] = result?.upcomingMatchUps ?? [];
      const pending: any[] = result?.pendingMatchUps ?? [];
      const all: any[] = [...matchUps, ...upcoming, ...pending];

      const teamMatchUp = all.find((m) => m?.matchUpId === parentMatchUpId);
      if (!teamMatchUp) {
        return { error: 'Parent matchUp not found in tournament' };
      }
      return { teamMatchUp };
    } catch (err: any) {
      this.logger.error(`getParentMatchUp failed: ${err?.message ?? err}`);
      return { error: err?.message ?? 'unknown error' };
    }
  }

  async getPlayerPointStats(params: {
    participantId: string;
    tournamentId?: string;
  }): Promise<{ stats?: PlayerPointStats; error?: string }> {
    return this.reporting.getPlayerPointStats(params);
  }

  async getTournamentLeaders(params: {
    tournamentId: string;
    limit?: number;
  }): Promise<{ leaders?: TournamentLeader[]; error?: string }> {
    return this.reporting.getTournamentLeaders(params);
  }

  async find(tieMatchUpId: string): Promise<{ document?: BoltHistoryDocument; error?: string }> {
    return this.storage.findBoltHistory({ tieMatchUpId });
  }

  async listForTournament(
    tournamentId: string,
  ): Promise<{ documents?: BoltHistoryDocument[]; error?: string }> {
    return this.storage.listBoltHistoryForTournament({ tournamentId });
  }

  async upsert(
    document: BoltHistoryDocument,
  ): Promise<{ success?: boolean; version?: number; error?: string }> {
    const result = await this.storage.saveBoltHistory({ document });
    if (result.error) return result;

    const persisted: BoltHistoryDocument = {
      ...document,
      version: result.version ?? document.version,
    };

    // Side-effects after a successful save: broadcast → project → enqueue for cloud.
    // All three are fire-and-forget so a downstream failure does not undo the storage write.
    try {
      this.broadcast.broadcastBoltHistory(persisted.tournamentId, persisted);
    } catch (err) {
      this.logger.warn(`broadcastBoltHistory failed: ${(err as Error)?.message ?? err}`);
    }

    void this.projector.project(persisted).catch((err) => {
      this.logger.warn(`projector.project failed: ${(err as Error)?.message ?? err}`);
    });

    if (this.outboundQueue && this.relayConfig.role === 'local' && this.relayConfig.cloudRelayUrl) {
      void this.outboundQueue
        .enqueue({
          venueId: this.relayConfig.venueId,
          kind: 'bolt-history',
          matchUpId: persisted.tieMatchUpId,
          payload: persisted,
        })
        .catch((err) => {
          this.logger.warn(`outboundQueue.enqueue failed: ${(err as Error)?.message ?? err}`);
        });
    }

    return result;
  }

  async remove(tieMatchUpId: string): Promise<{ success?: boolean; error?: string }> {
    return this.storage.removeBoltHistory({ tieMatchUpId });
  }
}
