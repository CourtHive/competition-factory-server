import { existingRecordFile } from './tournamentRecordFile';
import { STORAGE, UTF8 } from '../../common/constants/app';
import * as fs from 'fs-extra';

export async function findTournamentRecord({ tournamentId }) {
  fs.ensureDirSync(STORAGE);

  const tournamentFile = existingRecordFile(tournamentId);
  if (tournamentFile) {
    const record = fs.readFileSync(tournamentFile, UTF8);
    const tournamentRecord = JSON.parse(record);
    return { tournamentRecord };
  } else {
    return { error: 'Tournament not found' };
  }
}
