import { getTournamentRecords } from 'src/helpers/getTournamentRecords';

import { STORAGE, SUCCESS, UTF8 } from '../../common/constants/app';

import * as fs from 'fs-extra';

export async function saveTournamentRecords(params?: { tournamentRecords?: any; tournamentRecord?: any }) {
  const tournamentRecords = getTournamentRecords(params);

  fs.ensureDirSync(STORAGE);

  // TODO: ensure valid tournamentRecords
  for (const tournamentId of Object.keys(tournamentRecords)) {
    const content = JSON.stringify(tournamentRecords[tournamentId], null, 2);
    const tournamentFile = `${STORAGE}/${tournamentId}.tods.json`;
    fs.writeFileSync(tournamentFile, content, UTF8, (err) => {
      if (err) console.log(`error: ${err}`);
    });
  }
  return { ...SUCCESS };
}
