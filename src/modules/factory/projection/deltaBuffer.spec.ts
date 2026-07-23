import {
  createDeltaBuffer,
  recordAddDraw,
  recordAddMatchUps,
  recordDeleteDraw,
  recordMatchUpResult,
  recordParticipants,
  recordPositionAssignments,
} from './deltaBuffer';

describe('deltaBuffer recorders', () => {
  it('all recorders are no-ops when the buffer is undefined (feature off)', () => {
    // Must not throw and there is nothing to assert beyond "did not crash".
    expect(() => {
      recordAddMatchUps(undefined, [{ tournamentId: 't', matchUps: [{ drawId: 'd' }] }]);
      recordAddDraw(undefined, [{ tournamentId: 't', drawDefinition: { drawId: 'd' } }]);
      recordMatchUpResult(undefined, { tournamentId: 't', matchUp: { matchUpId: 'm' } });
      recordParticipants(undefined, [{ tournamentId: 't' }]);
      recordDeleteDraw(undefined, [{ tournamentId: 't', drawId: 'd' }]);
    }).not.toThrow();
  });

  it('recordAddMatchUps records one flattenDraw per distinct drawId + a touch', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordAddMatchUps(buffer, [{ tournamentId: 't-1', matchUps: [{ drawId: 'd1' }, { drawId: 'd1' }, { drawId: 'd2' }] }]);
    const draws = buffer.intents.filter((i) => i.kind === 'flattenDraw').map((i: any) => i.drawId);
    expect(new Set(draws)).toEqual(new Set(['d1', 'd2']));
    expect(buffer.intents.some((i) => i.kind === 'touchTournament')).toBe(true);
  });

  it('falls back to the sole mutation tournamentId when the notice omits it', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordAddDraw(buffer, [{ drawDefinition: { drawId: 'd9' } }]); // no tournamentId in payload
    expect(buffer.intents).toContainEqual({ kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd9' });
  });

  it('skips when tournamentId is ambiguous (multi-tournament mutation, payload omits it)', () => {
    const buffer = createDeltaBuffer(['t-1', 't-2']);
    recordAddDraw(buffer, [{ drawDefinition: { drawId: 'd9' } }]);
    expect(buffer.intents).toHaveLength(0);
  });

  it('recordPositionAssignments records a flatten for the affected draw', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordPositionAssignments(buffer, [{ tournamentId: 't-1', drawId: 'd1', structureId: 's1' }]);
    expect(buffer.intents).toContainEqual({ kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd1' });
  });

  it('recordParticipants de-dupes per tournament', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordParticipants(buffer, [{ tournamentId: 't-1' }, { tournamentId: 't-1' }]);
    expect(buffer.intents.filter((i) => i.kind === 'participants')).toHaveLength(1);
  });
});
