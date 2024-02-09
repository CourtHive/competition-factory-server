import * as fs from 'fs-extra';

import { STORAGE, SUCCESS } from '../../common/constants/app';

export async function removeTournamentRecords(params?: any) {
  const tournamentIds = params?.tournamentIds ?? [params?.tournamentId].filter(Boolean);
  let removed = 0;

  for (const tournamentId of tournamentIds) {
    const tournamentFile = `${STORAGE}/${tournamentId}.tods.json`;
    if ((await fs.existsSync(tournamentFile)) === true) {
      fs.removeSync(tournamentFile);
      removed += 1;
    }
  }

  return { ...SUCCESS, removed };
}
