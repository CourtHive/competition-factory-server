import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { ITournamentStorage } from '../interfaces/tournament-storage.interface';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { factoryConstants } from 'tods-competition-factory';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresTournamentStorage implements ITournamentStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findTournamentRecord({ tournamentId }: { tournamentId: string }) {
    const result = await this.pool.query('SELECT data FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    if (!result.rows.length) return { error: 'Tournament not found' };
    return { tournamentRecord: result.rows[0].data };
  }

  async fetchTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }) {
    if (!params) return { error: { message: 'No params provided' } };

    const tournamentIds =
      (params?.tournamentIds?.length && params.tournamentIds) || [params?.tournamentId].filter(Boolean);

    if (!tournamentIds.length) {
      return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };
    }

    const result = await this.pool.query(
      'SELECT tournament_id, data FROM tournaments WHERE tournament_id = ANY($1)',
      [tournamentIds],
    );

    const tournamentRecords: Record<string, any> = {};
    for (const row of result.rows) {
      tournamentRecords[row.tournament_id] = row.data;
    }

    const fetched = result.rows.length;
    const notFound = tournamentIds.length - fetched;

    if (!fetched) return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };

    return { ...SUCCESS, tournamentRecords, fetched, notFound };
  }

  async saveTournamentRecord({ tournamentRecord }: { tournamentRecord: any }) {
    const key = tournamentRecord?.tournamentId;
    if (!key) return { error: 'Invalid tournamentRecord' };

    const providerId = tournamentRecord.parentOrganisation?.organisationId ?? null;
    const tournamentName = tournamentRecord.tournamentName ?? null;
    const startDate = tournamentRecord.startDate ?? null;
    const endDate = tournamentRecord.endDate ?? null;

    await this.pool.query(
      `INSERT INTO tournaments (tournament_id, provider_id, tournament_name, start_date, end_date, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tournament_id) DO UPDATE SET
         provider_id = EXCLUDED.provider_id,
         tournament_name = EXCLUDED.tournament_name,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [key, providerId, tournamentName, startDate, endDate, JSON.stringify(tournamentRecord)],
    );

    return { ...SUCCESS };
  }

  async saveTournamentRecords(params: { tournamentRecords?: Record<string, any>; tournamentRecord?: any }) {
    const tournamentRecords = getTournamentRecords(params);

    for (const tournamentId of Object.keys(tournamentRecords)) {
      const result: any = await this.saveTournamentRecord({ tournamentRecord: tournamentRecords[tournamentId] });
      if (result.error) return result;
    }

    return { ...SUCCESS };
  }

  async removeTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }) {
    const tournamentIds = params?.tournamentIds ?? [params?.tournamentId].filter(Boolean);

    const result = await this.pool.query(
      'DELETE FROM tournaments WHERE tournament_id = ANY($1)',
      [tournamentIds],
    );

    return { ...SUCCESS, removed: result.rowCount ?? 0 };
  }

  async listTournamentIds(): Promise<string[]> {
    const result = await this.pool.query('SELECT tournament_id FROM tournaments ORDER BY tournament_id');
    return result.rows.map((row) => row.tournament_id);
  }
}
