import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { testTournamentId } from '../../../../common/constants/test';
import { tournamentEngine } from 'tods-competition-factory';
import fileStorage from '../../../../services/fileSystem';
import { executionQueue } from './executionQueue';
import 'dotenv/config';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

const tournamentId = testTournamentId(__filename);

const storage = {
  fetchTournamentRecords: (params) => fileStorage.fetchTournamentRecords(params),
  saveTournamentRecords: (params) => fileStorage.saveTournamentRecords(params),
  modifyProviderCalendar: () => Promise.resolve({ success: true }),
} as unknown as TournamentStorageService;

const testUser = { providerId: 'test-provider', roles: ['superadmin'] };

async function seeded() {
  await removeTournamentRecords({ tournamentId });
  const gen: any = await generateTournamentRecord(
    { tournamentAttributes: { tournamentId }, drawProfiles: [{ drawSize: 4 }] },
    testUser,
  );
  expect(gen.success).toEqual(true);

  const fetched: any = await fileStorage.fetchTournamentRecords({ tournamentId });
  tournamentEngine.setState(fetched.tournamentRecords[tournamentId], true);
  const matchUp: any = tournamentEngine.allTournamentMatchUps({ matchUpFilters: { roundNumbers: [1] } }).matchUps?.[0];
  return { matchUpId: matchUp.matchUpId, drawId: matchUp.drawId, participantId: matchUp.sides[0].participantId };
}

async function checkIns({ matchUpId, drawId }) {
  const fetched: any = await fileStorage.fetchTournamentRecords({ tournamentId });
  tournamentEngine.setState(fetched.tournamentRecords[tournamentId], true);
  return (tournamentEngine.getMatchUpCheckInHistory({ matchUpId, drawId }) as any).checkIns;
}

// Check-in slice 2: an intention that wrote nothing here must reach no other copy of the record. The ack's
// appliedMethods is what the sender applies, and what the controller broadcasts and the service mirrors.
describe('executionQueue presence intentions', () => {
  afterAll(() => removeTournamentRecords({ tournamentId }));

  it('applies one of two identical intentions and acknowledges only that one', async () => {
    const ids = await seeded();
    const intention = (attestationId: string) => ({
      method: 'setParticipantCheckInState',
      params: { ...ids, checkedIn: true, attestationId, occurredAt: '2026-11-12T22:00:00.000Z' },
    });

    const result: any = await executionQueue(
      { methods: [intention('first'), intention('second')], tournamentIds: [tournamentId] },
      undefined,
      storage,
    );
    expect(result.success).toEqual(true);
    expect(result.appliedMethods).toEqual([intention('first')]);

    const history = await checkIns(ids);
    expect(history.map((attestation: any) => attestation.attestationId)).toEqual(['first']);
  });

  it('acknowledges no methods when the state was already held', async () => {
    const ids = await seeded();
    const intention = (attestationId: string) => ({
      method: 'setParticipantCheckInState',
      params: { ...ids, checkedIn: true, attestationId },
    });

    let result: any = await executionQueue(
      { methods: [intention('winner')], tournamentIds: [tournamentId] },
      undefined,
      storage,
    );
    expect(result.success).toEqual(true);

    // a second desk that missed the winning write sends the same intention
    result = await executionQueue({ methods: [intention('stale')], tournamentIds: [tournamentId] }, undefined, storage);
    expect(result.success).toEqual(true);
    expect(result.appliedMethods).toEqual([]);

    const history = await checkIns(ids);
    expect(history.map((attestation: any) => attestation.attestationId)).toEqual(['winner']);
  });

  it('leaves the acknowledgement alone for a command that holds no intention', async () => {
    await seeded();
    const result: any = await executionQueue(
      {
        methods: [{ method: 'setTournamentName', params: { tournamentName: 'slice 2' } }],
        tournamentIds: [tournamentId],
      },
      undefined,
      storage,
    );
    expect(result.success).toEqual(true);
    expect(result.appliedMethods).toBeUndefined();
  });
});
