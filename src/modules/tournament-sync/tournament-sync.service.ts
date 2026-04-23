import { Injectable, Logger } from '@nestjs/common';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { RelayConfig } from '../relay/relay.config';

export interface SyncStatus {
  tournamentId: string;
  tournamentName?: string;
  lastSyncedAt: string;
  source: string;
}

/**
 * Local-only service that pulls tournament records from the upstream
 * cloud factory-server during pre-event setup.
 *
 * Stores pulled tournaments locally via TournamentStorageService and
 * tracks sync status in memory (reset on restart — sync status is
 * transient operational data, not durable state).
 */
@Injectable()
export class TournamentSyncService {
  private readonly logger = new Logger(TournamentSyncService.name);
  private readonly syncStatus = new Map<string, SyncStatus>();

  constructor(
    private readonly storageService: TournamentStorageService,
    private readonly config: RelayConfig,
  ) {}

  /**
   * List tournament IDs available on the upstream server.
   */
  async listRemoteTournaments(): Promise<{ success?: boolean; tournamentIds?: string[]; error?: string }> {
    const url = this.config.upstreamServerUrl;
    if (!url) return { error: 'UPSTREAM_SERVER_URL not configured' };

    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/factory/tournaments`, {
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        return { error: `Upstream returned HTTP ${response.status}` };
      }
      const data: any = await response.json();
      return { success: true, tournamentIds: data.tournamentIds ?? [] };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.error(`listRemoteTournaments failed: ${message}`);
      return { error: message };
    }
  }

  /**
   * Pull a specific tournament from the upstream server and store locally.
   */
  async pullTournament(tournamentId: string): Promise<{ success?: boolean; tournamentName?: string; error?: string }> {
    const url = this.config.upstreamServerUrl;
    if (!url) return { error: 'UPSTREAM_SERVER_URL not configured' };

    try {
      const response = await fetch(
        `${url.replace(/\/$/, '')}/factory/tournaments/${tournamentId}/export`,
        { headers: this.authHeaders() },
      );
      if (!response.ok) {
        return { error: `Upstream returned HTTP ${response.status}` };
      }

      const data: any = await response.json();
      if (data.error || !data.tournamentRecord) {
        return { error: data.error ?? 'No tournament record in response' };
      }

      const tournamentRecord = data.tournamentRecord;
      const saveResult = await this.storageService.saveTournamentRecord({ tournamentRecord });
      if (saveResult.error) {
        return { error: saveResult.error };
      }

      const tournamentName = tournamentRecord.tournamentName;
      this.syncStatus.set(tournamentId, {
        tournamentId,
        tournamentName,
        lastSyncedAt: new Date().toISOString(),
        source: url,
      });

      this.logger.log(`pulled tournament: ${tournamentName ?? tournamentId}`);
      return { success: true, tournamentName };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.error(`pullTournament(${tournamentId}) failed: ${message}`);
      return { error: message };
    }
  }

  /**
   * Return sync status for all pulled tournaments.
   */
  getSyncStatus(): SyncStatus[] {
    return Array.from(this.syncStatus.values());
  }

  /**
   * Return sync status for a specific tournament.
   */
  getTournamentSyncStatus(tournamentId: string): SyncStatus | undefined {
    return this.syncStatus.get(tournamentId);
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = this.config.upstreamApiKey;
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }
    return headers;
  }
}
