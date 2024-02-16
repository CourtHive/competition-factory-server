import { generateTournamentRecord as gen } from 'src/modules/factory/helpers/generateTournamentRecord';
import { saveTournamentRecords } from './saveTournamentRecords';

import { SUCCESS } from '../../common/constants/app';

export async function generateTournamentRecord(genProfile?: any, user?: any) {
  const { tournamentRecord, tournamentRecords } = await gen(genProfile, user);
  await saveTournamentRecords({ tournamentRecords });
  return { tournamentRecord, ...SUCCESS };
}
