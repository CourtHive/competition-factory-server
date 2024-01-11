import { saveTournamentRecords } from './saveTournamentRecords';
import { governors } from 'tods-competition-factory';

import { SUCCESS } from '../../common/constants/app';

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
