import { governors } from 'tods-competition-factory';
import netLevel from './netLevel';

import { factoryConstants } from 'tods-competition-factory';
import { SUCCESS } from '../../common/constants/app';
import { BASE_TOURNAMENT } from './constants';

async function findTournamentRecord({ tournamentId }) {
  const tournamentRecord = await netLevel.get(BASE_TOURNAMENT, { key: tournamentId });
  if (!tournamentId) return { error: 'Tournament not found' };
  return { tournamentRecord };
}

export async function fetchTournamentRecords(params?: { tournamentIds?: string[]; tournamentId?: string }) {
  if (!params) return { error: { message: 'No params provided' } };

  const tournamentIds =
    (params?.tournamentIds?.length && params.tournamentIds) || [params?.tournamentId].filter(Boolean);

  const tournamentRecords = {};
  let fetched = 0,
    notFound = 0;
  for (const tournamentId of tournamentIds) {
    const result: any = await findTournamentRecord({ tournamentId });
    if (result.tournamentRecord) {
      const tournamentId = result.tournamentRecord?.tournamentId;
      tournamentRecords[tournamentId] = result.tournamentRecord;
      fetched += 1;
    } else {
      notFound += 1;
    }
  }

  if (!fetched) return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };

  return { ...SUCCESS, tournamentRecords, fetched, notFound };
}

async function saveTournamentRecord({ tournamentRecord }) {
  const storageRecord = {
    key: tournamentRecord.tournamentId,
    value: tournamentRecord,
  };

  await netLevel.set(BASE_TOURNAMENT, storageRecord);
  return { ...SUCCESS };
}

async function saveTournamentRecords(params?: { tournamentRecords?: any; tournamentRecord?: any }) {
  const tournamentRecords =
    params?.tournamentRecords ??
    (params?.tournamentRecord ? { [params.tournamentRecord.tournamentId]: params.tournamentRecord } : {});

  for (const tournamentId of Object.keys(tournamentRecords)) {
    saveTournamentRecord({ tournamentRecord: tournamentRecords[tournamentId] });
  }

  return { ...SUCCESS };
}

async function removeTournamentRecords(params?: any) {
  const tournamentIds = params?.tournamentIds ?? [params?.tournamentId].filter(Boolean);
  let removed = 0;

  for (const tournamentId of tournamentIds) {
    await netLevel.delete(BASE_TOURNAMENT, { key: tournamentId });
    removed += 1;
  }

  return { ...SUCCESS, removed };
}

export function generateTournamentRecord(mockProfile?: any) {
  const mockResult = governors.mocksGovernor.generateTournamentRecord(mockProfile);

  if (!mockResult || mockResult.error) {
    throw new Error(mockResult?.error || 'Could not generate tournament record');
  }

  const tournamentRecord: any = mockResult.tournamentRecord;
  const tournamentRecords: any = { [tournamentRecord.tournamentId]: tournamentRecord };
  saveTournamentRecords({ tournamentRecords });

  return { tournamentRecord, ...SUCCESS };
}

export const levelStorage = {
  generateTournamentRecord,
  removeTournamentRecords,
  fetchTournamentRecords,
  saveTournamentRecords,
  saveTournamentRecord,
  findTournamentRecord,
};

export default levelStorage;
