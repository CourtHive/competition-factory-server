import { parseCtsTournament } from './parseCtsTournament';
import netLevel from 'src/services/levelDB/netLevel';
import levelStorage from 'src/services/levelDB';
import { parse } from 'node-html-parser';
import axios from 'axios';

import { BASE_CALENDAR } from 'dist/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

export async function fetchCtsTournament({ identifier, tournamentId }) {
  try {
    const result = await axios.request({ url: identifier, method: 'GET', headers: { Accept: 'application/json' } });
    const doc = parse(result.data);
    const tournamentRecord = parseCtsTournament({ doc, tournamentId });
    const providerCalendar: any = await netLevel.get(BASE_CALENDAR, {
      key: tournamentRecord.parentOrganisation?.organisationId,
    });
    const providerTournamentIds = (providerCalendar?.value?.tournaments || []).map((t) => t.tournamentId);
    // check whether the tournament is already in the database
    // if not, add it
    if (!providerTournamentIds.includes(tournamentRecord.tournamentId)) {
      await levelStorage.saveTournamentRecord({ tournamentRecord });
    }
    return { ...SUCCESS, tournamentRecord };
  } catch (err) {
    return { error: `request failed` };
  }
}
