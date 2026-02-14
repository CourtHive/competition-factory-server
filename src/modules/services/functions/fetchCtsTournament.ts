import { parseCtsTournament } from './parseCtsTournament';
import { parse } from 'node-html-parser';
import axios from 'axios';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { ICalendarStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

export async function fetchCtsTournament(
  { identifier, tournamentId },
  storage: TournamentStorageService,
  calendarStorage: ICalendarStorage,
) {
  try {
    const result = await axios.request({ url: identifier, method: 'GET', headers: { Accept: 'application/json' } });
    const doc = parse(result.data);
    const tournamentRecord = parseCtsTournament({ doc, tournamentId });
    const providerCalendar: any = await calendarStorage.getCalendar(
      tournamentRecord.parentOrganisation?.organisationId,
    );
    const providerTournamentIds = (providerCalendar?.tournaments || []).map((t) => t.tournamentId);
    // check whether the tournament is already in the database
    // if not, add it
    if (!providerTournamentIds.includes(tournamentRecord.tournamentId)) {
      await storage.saveTournamentRecord({ tournamentRecord });
    }
    return { ...SUCCESS, tournamentRecord };
  } catch {
    return { error: `request failed` };
  }
}
