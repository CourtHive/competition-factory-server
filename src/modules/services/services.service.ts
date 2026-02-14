// import cpTable from 'codepage'; // see HiveEye server for example use
import { fetchCtsTournament } from './functions/fetchCtsTournament';
import { Inject, Injectable } from '@nestjs/common';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { CALENDAR_STORAGE, type ICalendarStorage } from 'src/storage/interfaces';

@Injectable()
export class Services {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    @Inject(CALENDAR_STORAGE) private readonly calendarStorage: ICalendarStorage,
  ) {}

  async fetchTournamentDetails(params) {
    if (typeof params.identifier !== 'string') return { error: 'Invalid parameters' };

    const parts = params.identifier
      .toLowerCase()
      .split('/')
      .filter((part) => part && part !== '/');

    if (parts[0].startsWith('http')) {
      // optionally check that user has this service in user.services

      if (parts.includes('turnaj')) {
        // Identified as a CTS tournament
        const tournamentId = parts[parts.indexOf('turnaj') + 1];
        const season = parts[parts.indexOf('sezona') + 1];

        if (tournamentId && season) {
          return fetchCtsTournament(
            { tournamentId, identifier: params.identifier },
            this.tournamentStorageService,
            this.calendarStorage,
          );
        } else {
          return { error: 'Invalid parameters' };
        }
      }
    }

    return { error: 'Invalid parameters' };
  }
}
