import { ITournamentStorage } from '../interfaces/tournament-storage.interface';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { factoryConstants } from 'tods-competition-factory';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_TOURNAMENT } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class LeveldbTournamentStorage implements ITournamentStorage {
  async findTournamentRecord({ tournamentId }: { tournamentId: string }) {
    const tournamentRecord = await netLevel.get(BASE_TOURNAMENT, { key: tournamentId });
    if (!tournamentRecord) return { error: 'Tournament not found' };
    return { tournamentRecord };
  }

  async fetchTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }) {
    if (!params) return { error: { message: 'No params provided' } };

    const tournamentIds: string[] =
      (params?.tournamentIds?.length && params.tournamentIds) || [params?.tournamentId].filter(Boolean) as string[];

    const tournamentRecords: Record<string, any> = {};
    let fetched = 0;
    let notFound = 0;

    for (const tournamentId of tournamentIds) {
      const result: any = await this.findTournamentRecord({ tournamentId });
      if (result.tournamentRecord) {
        const id = result.tournamentRecord?.tournamentId;
        tournamentRecords[id] = result.tournamentRecord;
        fetched += 1;
      } else {
        notFound += 1;
      }
    }

    if (!fetched) return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };

    return { ...SUCCESS, tournamentRecords, fetched, notFound };
  }

  async saveTournamentRecord({ tournamentRecord }: { tournamentRecord: any }) {
    const key = tournamentRecord?.tournamentId;
    if (!key) return { error: 'Invalid tournamentRecord' };
    await netLevel.set(BASE_TOURNAMENT, { key, value: tournamentRecord });
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
    let removed = 0;

    for (const tournamentId of tournamentIds) {
      await netLevel.delete(BASE_TOURNAMENT, { key: tournamentId });
      removed += 1;
    }

    return { ...SUCCESS, removed };
  }

  async listTournamentIds(): Promise<string[]> {
    const keysValues = (await netLevel.keys(BASE_TOURNAMENT, { from: 0 })) as Array<any>;
    return keysValues?.map((kv) => kv.key)?.filter(Boolean) ?? [];
  }
}
