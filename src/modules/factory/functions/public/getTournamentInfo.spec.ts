import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { publishingGovernor } from 'tods-competition-factory';
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

/**
 * The SEAM between this function and the controller's gate (P23 D4b).
 *
 * The controller decides visibility from `visibleFrom`, and reads an absent value as "visible now"
 * — correctly, since that is the case for almost every tournament. The consequence is that if this
 * function ever stops emitting the field, every embargo goes silently inert and no test of the
 * controller notices, because those build their payloads by hand. This is the test that notices.
 */
describe('getTournamentInfo — visibleFrom (the embargo seam)', () => {
  const EMBARGO_TID = 'test-info-embargo-visible-from';
  const FUTURE = '2099-01-01T00:00:00Z';

  beforeAll(async () => {
    await removeTournamentRecords({ tournamentId: EMBARGO_TID });
    const result = await generateTournamentRecord(
      { tournamentAttributes: { tournamentId: EMBARGO_TID }, drawProfiles: [{ drawSize: 8 }] },
      testUser,
    );
    expect(result.success).toEqual(true);
  });

  afterAll(async () => {
    await removeTournamentRecords({ tournamentId: EMBARGO_TID });
  });

  it('is null for a tournament with no information embargo', async () => {
    const result: any = await getTournamentInfo({ tournamentId: EMBARGO_TID }, storage);
    expect(result.success).toEqual(true);
    // Present and null — not absent. The field existing is what keeps the controller's gate live.
    expect(result.visibleFrom).toEqual(null);
  });

  it('carries the instant when information is published with a future embargo', async () => {
    const { tournamentRecord }: any = await storage.findTournamentRecord({ tournamentId: EMBARGO_TID });
    expect(publishingGovernor.publishTournamentInfo({ tournamentRecord, embargo: FUTURE }).success).toEqual(true);
    await (storage as any).saveTournamentRecords({ tournamentRecord });

    const result: any = await getTournamentInfo({ tournamentId: EMBARGO_TID }, storage);

    expect(result.visibleFrom).toEqual(FUTURE);
  });
});
