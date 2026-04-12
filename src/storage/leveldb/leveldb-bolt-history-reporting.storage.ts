import { Injectable } from '@nestjs/common';
import netLevel from 'src/services/levelDB/netLevel';

import {
  IBoltHistoryReporting,
  PlayerPointStats,
  TournamentLeader,
} from '../interfaces/bolt-history-reporting.interface';
import { BoltHistoryDocument } from '../interfaces/bolt-history.interface';
import { BASE_BOLT_HISTORY } from 'src/services/levelDB/constants';

/**
 * In-process aggregation reporting adapter for LevelDB.
 *
 * Loads every stored BoltHistoryDocument, then iterates the
 * `engineState.history.points` array on each one to compute aggregates.
 *
 * Acceptable for dev / small tournaments. The Postgres adapter uses
 * proper JSONB queries and should be the production target.
 */
@Injectable()
export class LeveldbBoltHistoryReportingStorage implements IBoltHistoryReporting {
  async getPlayerPointStats({
    participantId,
    tournamentId,
  }: {
    participantId: string;
    tournamentId?: string;
  }): Promise<{ stats?: PlayerPointStats; error?: string }> {
    if (!participantId) return { error: 'participantId required' };
    const documents = await this.loadDocuments(tournamentId);

    let pointsWon = 0;
    let pointsPlayed = 0;
    let matchUpsParticipated = 0;

    for (const doc of documents) {
      const wasParticipant = doc.sides?.some((s) => s.participant?.participantId === participantId);
      if (!wasParticipant) continue;
      matchUpsParticipated += 1;

      const points: any[] = doc.engineState?.history?.points ?? [];
      for (const point of points) {
        pointsPlayed += 1;
        if (point?.winnerParticipantId === participantId) pointsWon += 1;
      }
    }

    return {
      stats: {
        participantId,
        pointsWon,
        pointsPlayed,
        winRate: pointsPlayed === 0 ? 0 : pointsWon / pointsPlayed,
        matchUpsParticipated,
      },
    };
  }

  async getTournamentLeaders({
    tournamentId,
    limit,
  }: {
    tournamentId: string;
    limit?: number;
  }): Promise<{ leaders?: TournamentLeader[]; error?: string }> {
    if (!tournamentId) return { error: 'tournamentId required' };
    const documents = await this.loadDocuments(tournamentId);

    const tally = new Map<string, TournamentLeader>();

    for (const doc of documents) {
      const nameById = new Map<string, string | undefined>();
      for (const side of doc.sides ?? []) {
        if (side.participant?.participantId) {
          nameById.set(side.participant.participantId, side.participant.participantName);
        }
      }
      for (const participantId of nameById.keys()) {
        const existing = tally.get(participantId) ?? {
          participantId,
          participantName: nameById.get(participantId),
          pointsWon: 0,
          matchUpsParticipated: 0,
        };
        existing.matchUpsParticipated += 1;
        tally.set(participantId, existing);
      }

      const points: any[] = doc.engineState?.history?.points ?? [];
      for (const point of points) {
        const winnerId = point?.winnerParticipantId;
        if (!winnerId) continue;
        const existing = tally.get(winnerId);
        if (existing) existing.pointsWon += 1;
      }
    }

    const leaders = Array.from(tally.values()).sort((a, b) => b.pointsWon - a.pointsWon);
    return { leaders: leaders.slice(0, limit ?? 10) };
  }

  private async loadDocuments(tournamentId?: string): Promise<BoltHistoryDocument[]> {
    const raw = (await netLevel.list(BASE_BOLT_HISTORY, { all: true })) as
      | { key: string; value: BoltHistoryDocument }[]
      | undefined;
    const docs = (raw ?? []).map((row) => row.value).filter(Boolean);
    return tournamentId ? docs.filter((d) => d.tournamentId === tournamentId) : docs;
  }
}
