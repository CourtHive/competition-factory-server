import { generateTournamentRecord as gen } from 'src/modules/factory/helpers/generateTournamentRecord';
import { addToOrUpdateCalendar, removeFromCalendar } from 'src/modules/providers/updateCalendar';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { SUCCESS } from '../../common/constants/app';
import netLevel from './netLevel';

import { factoryConstants } from 'tods-competition-factory';
import { BASE_TOURNAMENT } from './constants';
import { TEST } from 'src/common/constants/test';

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
  const key = tournamentRecord?.tournamentId;
  if (!key) return { error: 'Invalid tournamentRecord' };
  const storageRecord = { key, value: tournamentRecord };
  const providerId = tournamentRecord.parentOrganisation?.organisationId;
  if (!providerId && key !== TEST) return { error: 'Missing providerId' };
  if (providerId) {
    await addToOrUpdateCalendar({
      tournamentRecord,
      providerId,
    });
  }

  await netLevel.set(BASE_TOURNAMENT, storageRecord);
  netLevel.exit();
  return { ...SUCCESS };
}

async function saveTournamentRecords(params?: { tournamentRecords?: any; tournamentRecord?: any }) {
  const tournamentRecords = getTournamentRecords(params);

  for (const tournamentId of Object.keys(tournamentRecords)) {
    const result: any = await saveTournamentRecord({ tournamentRecord: tournamentRecords[tournamentId] });
    if (result.error) return result;
  }

  return { ...SUCCESS };
}

async function removeTournamentRecords(params?: any, user?: any) {
  const tournamentIds = params?.tournamentIds ?? [params?.tournamentId].filter(Boolean);
  const providerId = user?.providerId || params.providerId;
  let removed = 0;

  for (const tournamentId of tournamentIds) {
    if (!user.permissions || user.permissions.includes('deleteTournament') || user.roles?.includes('superadmin')) {
      await netLevel.delete(BASE_TOURNAMENT, { key: tournamentId });
      if (providerId) {
        await removeFromCalendar({ providerId, tournamentId });
        removed += 1;
      }
    }
  }

  netLevel.exit();
  return { ...SUCCESS, removed };
}

export async function generateTournamentRecord(genProfile?: any, user?: any) {
  const { tournamentRecord, tournamentRecords } = await gen(genProfile, user);
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
