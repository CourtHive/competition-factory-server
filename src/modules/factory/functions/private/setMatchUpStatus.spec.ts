import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { tournamentEngine, factoryConstants } from 'tods-competition-factory';
import fileStorage from '../../../../services/fileSystem';
import { setMatchUpStatus } from './setMatchUpStatus';
import 'dotenv/config';

// types
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

const { COMPLETED } = factoryConstants.matchUpStatusConstants;
const { MISSING_TOURNAMENT_RECORD } = factoryConstants.errorConditionConstants;

const mockStorage = {
  fetchTournamentRecords: (params) => fileStorage.fetchTournamentRecords(params),
  saveTournamentRecords: (params) => fileStorage.saveTournamentRecords(params),
  modifyProviderCalendar: () => Promise.resolve({ success: true }),
} as unknown as TournamentStorageService;

const TOURNAMENT_ID = 'test-score';

describe('setMatchUpStatus', () => {
  let drawId: string;
  let matchUpId: string;

  beforeAll(async () => {
    await removeTournamentRecords({ tournamentId: TOURNAMENT_ID });

    const genResult = await generateTournamentRecord({
      tournamentAttributes: { tournamentId: TOURNAMENT_ID },
      drawProfiles: [{ drawSize: 4 }],
    });
    expect(genResult.success).toEqual(true);

    // Extract a valid matchUpId and drawId from the generated record
    const { tournamentRecord } = genResult;
    const event = tournamentRecord.events[0];
    const drawDefinition = event.drawDefinitions[0];
    drawId = drawDefinition.drawId;

    // Find a matchUp that is ready to score (has participants on both sides)
    tournamentEngine.setState(tournamentRecord);
    const { matchUps } = tournamentEngine.allTournamentMatchUps({ inContext: true });
    const readyMatchUp = matchUps.find((m: any) => m.readyToScore && !m.winningSide);
    expect(readyMatchUp).toBeDefined();
    matchUpId = readyMatchUp.matchUpId;
  });

  afterAll(async () => {
    await removeTournamentRecords({ tournamentId: TOURNAMENT_ID });
  });

  it('scores a matchUp via the score route payload shape', async () => {
    let result: any = await setMatchUpStatus(
      {
        tournamentId: TOURNAMENT_ID,
        drawId,
        matchUpId,
        outcome: {
          score: {
            sets: [
              { side1Score: 6, side2Score: 1, winningSide: 1, setNumber: 1 },
              { side1Score: 6, side2Score: 2, winningSide: 1, setNumber: 2 },
            ],
          },
          matchUpFormat: 'SET3-S:6/TB7',
          matchUpStatus: COMPLETED,
          winningSide: 1,
        },
      },
      undefined,
      mockStorage,
    );
    expect(result.success).toEqual(true);
  });

  it('returns error for non-existent tournament', async () => {
    let result: any = await setMatchUpStatus(
      {
        tournamentId: 'does-not-exist',
        drawId,
        matchUpId,
        outcome: {
          score: { sets: [{ side1Score: 6, side2Score: 0, winningSide: 1, setNumber: 1 }] },
          matchUpFormat: 'SET3-S:6/TB7',
          matchUpStatus: COMPLETED,
          winningSide: 1,
        },
      },
      undefined,
      mockStorage,
    );
    expect(result.error).toEqual(MISSING_TOURNAMENT_RECORD);
  });

  it('returns error when tournamentId is missing', async () => {
    let result: any = await setMatchUpStatus(
      {
        drawId,
        matchUpId,
        outcome: {
          score: { sets: [{ side1Score: 6, side2Score: 0, winningSide: 1, setNumber: 1 }] },
          matchUpFormat: 'SET3-S:6/TB7',
          matchUpStatus: COMPLETED,
          winningSide: 1,
        },
      },
      undefined,
      mockStorage,
    );
    expect(result.error).toBeDefined();
  });

  it('extracts tournamentId from top-level DTO payload', async () => {
    let result: any = await setMatchUpStatus(
      {
        tournamentId: TOURNAMENT_ID,
        drawId,
        matchUpId: 'non-existent-matchup',
        outcome: {
          score: { sets: [{ side1Score: 6, side2Score: 0, winningSide: 1, setNumber: 1 }] },
          matchUpFormat: 'SET3-S:6/TB7',
          matchUpStatus: COMPLETED,
          winningSide: 1,
        },
      },
      undefined,
      mockStorage,
    );
    // Should NOT get "No tournamentIds provided" — tournamentId was found at top level
    expect(result.error).not.toEqual('No tournamentIds provided');
  });

  it('supports legacy wrapper with params containing tournamentId', async () => {
    let result: any = await setMatchUpStatus(
      {
        params: {
          tournamentId: TOURNAMENT_ID,
          drawId,
          matchUpId: 'non-existent-matchup',
          outcome: {
            score: { sets: [{ side1Score: 6, side2Score: 0, winningSide: 1, setNumber: 1 }] },
            matchUpFormat: 'SET3-S:6/TB7',
            matchUpStatus: COMPLETED,
            winningSide: 1,
          },
        },
      },
      undefined,
      mockStorage,
    );
    // Should NOT get "No tournamentIds provided" — tournamentId found inside legacy params wrapper
    expect(result.error).not.toEqual('No tournamentIds provided');
  });
});
