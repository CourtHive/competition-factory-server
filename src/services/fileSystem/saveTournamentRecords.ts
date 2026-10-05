import { getTournamentRecords } from 'src/helpers/getTournamentRecords';

import { STORAGE, SUCCESS, UTF8 } from '../../common/constants/app';

import { codesRecordFile, legacyRecordFile } from './tournamentRecordFile';
import * as fs from 'fs-extra';

export async function saveTournamentRecords(params?: { tournamentRecords?: any; tournamentRecord?: any }) {
  const tournamentRecords = getTournamentRecords(params);

  fs.ensureDirSync(STORAGE);

  // TODO: ensure valid tournamentRecords and that user is either superadmin or admin of the tournamentRecord.provider
  for (const tournamentId of Object.keys(tournamentRecords)) {
    const content = JSON.stringify(tournamentRecords[tournamentId], null, 2);
    fs.writeFileSync(codesRecordFile(tournamentId), content, UTF8, (err) => {
      if (err) console.log(`error: ${err}`);
    });
    // the codes file now shadows any legacy copy; drop it so the two can never disagree
    fs.removeSync(legacyRecordFile(tournamentId));
  }
  return { ...SUCCESS };
}
