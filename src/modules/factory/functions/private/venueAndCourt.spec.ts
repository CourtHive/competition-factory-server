import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { queryTournamentRecords } from './queryTournamentRecords';
import { TEST } from '../../../../common/constants/test';
import fileStorage from '../../../../services/fileSystem';
import { executionQueue } from './executionQueue';
import 'dotenv/config';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { ITournamentStorage } from 'src/storage/interfaces';

const mockStorage = {
  fetchTournamentRecords: (params) => fileStorage.fetchTournamentRecords(params),
  saveTournamentRecords: (params) => fileStorage.saveTournamentRecords(params),
  modifyProviderCalendar: () => Promise.resolve({ success: true }),
} as unknown as TournamentStorageService;

const queryStorage = fileStorage as unknown as ITournamentStorage;

const venueId = 'venue-01';
const courtId = 'court-01';

describe('addVenue and addCourt via executionQueue', () => {
  beforeAll(async () => {
    await removeTournamentRecords({ tournamentId: TEST });

    let result: any = await generateTournamentRecord({
      tournamentAttributes: { tournamentId: TEST },
    });
    expect(result.success).toEqual(true);
  });

  afterAll(async () => {
    await removeTournamentRecords({ tournamentId: TEST });
  });

  it('can add a venue and court in a single executionQueue', async () => {
    let result: any = await executionQueue(
      {
        tournamentId: TEST,
        methods: [
          {
            method: 'addVenue',
            params: {
              venue: {
                venueId,
                venueName: 'Test Venue',
                venueAbbreviation: 'TV',
              },
            },
          },
          {
            method: 'addCourt',
            params: {
              venueId,
              court: {
                courtId,
                courtName: 'Court 1',
              },
            },
          },
        ],
      },
      undefined,
      mockStorage,
    );
    expect(result.success).toEqual(true);

    result = await queryTournamentRecords(
      {
        method: 'getVenuesAndCourts',
        params: { tournamentId: TEST },
        tournamentId: TEST,
      },
      queryStorage,
    );
    expect(result.success).toEqual(true);
    expect(result.venues.length).toEqual(1);
    expect(result.venues[0].venueId).toEqual(venueId);
    expect(result.venues[0].venueName).toEqual('Test Venue');
    expect(result.courts.length).toEqual(1);
    expect(result.courts[0].courtId).toEqual(courtId);
    expect(result.courts[0].courtName).toEqual('Court 1');
  });
});
