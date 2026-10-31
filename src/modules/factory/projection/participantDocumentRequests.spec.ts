import { documentRequestTournamentIds } from './participantDocumentRequests';

describe('documentRequestTournamentIds', () => {
  const tournamentIds = ['t-1', 't-2'];

  it('requests nothing for scoring, draws or schedules', () => {
    const intents: any[] = [
      { kind: 'matchUpResult', tournamentId: 't-1', matchUp: {} },
      { kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd' },
      { kind: 'orderOfPlay', tournamentId: 't-1' },
      { kind: 'touchTournament', tournamentId: 't-1' },
    ];
    expect(documentRequestTournamentIds({ intents, methods: [{ method: 'setMatchUpStatus' }], tournamentIds })).toEqual(
      [],
    );
  });

  it('requests each tournament a participant change touched, once', () => {
    const intents: any[] = [
      { kind: 'participants', tournamentId: 't-2' },
      { kind: 'deleteParticipants', tournamentId: 't-2', participantIds: ['p'] },
      { kind: 'claimPerson', tournamentId: 't-1', participantId: 'p', personId: 'x' },
    ];
    expect(documentRequestTournamentIds({ intents, tournamentIds }).sort()).toEqual(['t-1', 't-2']);
  });

  it('requests every tournament of a call that attaches or removes a policy', () => {
    for (const method of ['attachPolicies', 'removePolicy']) {
      expect(documentRequestTournamentIds({ intents: [], methods: [{ method }], tournamentIds })).toEqual(
        tournamentIds,
      );
    }
  });
});
