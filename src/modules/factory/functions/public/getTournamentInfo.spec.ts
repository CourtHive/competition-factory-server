import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import fileStorage from '../../../../services/fileSystem';
import { getTournamentInfo } from './getTournamentInfo';
import 'dotenv/config';

import type { ITournamentStorage } from 'src/storage/interfaces';

const storage = fileStorage as unknown as ITournamentStorage;
const TEST_TID = 'test-epixodic-tournament-info';

const testUser = { providerId: 'test-provider', roles: ['superadmin'] };

describe('getTournamentInfo for epixodic', () => {
  beforeAll(async () => {
    await removeTournamentRecords({ tournamentId: TEST_TID });
    const result = await generateTournamentRecord(
      {
        tournamentAttributes: { tournamentId: TEST_TID },
        drawProfiles: [{ drawSize: 8 }, { drawSize: 16 }],
      },
      testUser,
    );
    expect(result.success).toEqual(true);
  });

  afterAll(async () => {
    await removeTournamentRecords({ tournamentId: TEST_TID });
  });

  it('returns eventInfo with all events when usePublishState is not set', async () => {
    const result: any = await getTournamentInfo(
      { tournamentId: TEST_TID, withMatchUpStats: true, withStructureDetails: true },
      storage,
    );

    expect(result.success).toEqual(true);
    expect(result.tournamentInfo).toBeDefined();
    expect(result.tournamentInfo.tournamentId).toEqual(TEST_TID);

    // Without usePublishState, all events should be returned regardless of publish status
    expect(result.tournamentInfo.eventInfo).toBeDefined();
    expect(result.tournamentInfo.eventInfo.length).toBeGreaterThanOrEqual(2);

    // Each event should have required fields for epixodic
    for (const event of result.tournamentInfo.eventInfo) {
      expect(event.eventId).toBeDefined();
      expect(event.eventName).toBeDefined();
      expect(event.eventType).toBeDefined();
    }

    // withMatchUpStats should provide matchUpStats
    expect(result.tournamentInfo.matchUpStats).toBeDefined();
    expect(result.tournamentInfo.matchUpStats.total).toBeGreaterThan(0);

    // withStructureDetails should provide structures
    expect(result.tournamentInfo.structures).toBeDefined();
    expect(result.tournamentInfo.structures.length).toBeGreaterThan(0);
  });

  it('returns empty eventInfo when usePublishState is true and nothing is published', async () => {
    const result: any = await getTournamentInfo(
      { tournamentId: TEST_TID, usePublishState: true },
      storage,
    );

    expect(result.success).toEqual(true);
    expect(result.tournamentInfo).toBeDefined();

    // No events are published, so eventInfo should be empty
    expect(result.tournamentInfo.eventInfo).toBeDefined();
    expect(result.tournamentInfo.eventInfo.length).toEqual(0);
  });

  it('includes tournamentName, startDate, endDate', async () => {
    const result: any = await getTournamentInfo(
      { tournamentId: TEST_TID },
      storage,
    );

    expect(result.success).toEqual(true);
    expect(result.tournamentInfo.tournamentName).toBeDefined();
    expect(result.tournamentInfo.startDate).toBeDefined();
    expect(result.tournamentInfo.endDate).toBeDefined();
  });
});
