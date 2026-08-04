import {
  createDeltaBuffer,
  recordAddDraw,
  recordAddMatchUps,
  recordDeleteDraw,
  recordDeleteEvent,
  recordDraw,
  recordDeleteMatchUps,
  recordEntries,
  recordEvents,
  recordOrderOfPlay,
  recordSchedulingProfile,
  recordSeeds,
  recordMatchUpResult,
  recordParticipants,
  recordPersonClaims,
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

  it('recordEntries records one entries intent per tournament and de-dupes', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordEntries(buffer, [
      { tournamentId: 't-1', eventId: 'e1' },
      { tournamentId: 't-1', drawId: 'd1' },
    ]);
    expect(buffer.intents.filter((i) => i.kind === 'entries')).toEqual([{ kind: 'entries', tournamentId: 't-1' }]);
  });

  it('recordEntries falls back to the sole mutation tournamentId when the notice omits it', () => {
    const buffer = createDeltaBuffer(['t-9']);
    recordEntries(buffer, [{ eventId: 'e1' }]); // no tournamentId in payload
    expect(buffer.intents).toContainEqual({ kind: 'entries', tournamentId: 't-9' });
  });

  it('recordEntries is a no-op when the buffer is undefined (feature off)', () => {
    expect(() => recordEntries(undefined, [{ tournamentId: 't-1', eventId: 'e1' }])).not.toThrow();
  });

  it('recordEvents records one events intent per tournament and de-dupes', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordEvents(buffer, [{ tournamentId: 't-1', event: { eventId: 'e1' } }, { tournamentId: 't-1' }]);
    expect(buffer.intents.filter((i) => i.kind === 'events')).toEqual([{ kind: 'events', tournamentId: 't-1' }]);
  });

  it('recordDeleteEvent records a deleteEvent intent per eventId', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordDeleteEvent(buffer, [{ tournamentId: 't-1', eventIds: ['e1', 'e2'] }]);
    expect(buffer.intents.filter((i) => i.kind === 'deleteEvent')).toEqual([
      { kind: 'deleteEvent', tournamentId: 't-1', eventId: 'e1' },
      { kind: 'deleteEvent', tournamentId: 't-1', eventId: 'e2' },
    ]);
  });

  it('recordEvents / recordDeleteEvent are no-ops when the buffer is undefined (feature off)', () => {
    expect(() => {
      recordEvents(undefined, [{ tournamentId: 't-1' }]);
      recordDeleteEvent(undefined, [{ tournamentId: 't-1', eventIds: ['e1'] }]);
    }).not.toThrow();
  });

  it('recordDraw records a draw intent from drawDefinition.drawId (falls back to sole tournamentId)', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordDraw(buffer, [{ drawDefinition: { drawId: 'd1' } }]); // payload omits tournamentId
    expect(buffer.intents).toContainEqual({ kind: 'draw', tournamentId: 't-1', drawId: 'd1' });
    expect(() => recordDraw(undefined, [{ drawDefinition: { drawId: 'd1' } }])).not.toThrow();
  });

  it('recordOrderOfPlay records one orderOfPlay intent per tournament (deduped)', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordOrderOfPlay(buffer, [{ tournamentId: 't-1', scheduledDates: ['2025-01-05'] }, { tournamentId: 't-1' }]);
    expect(buffer.intents.filter((i) => i.kind === 'orderOfPlay')).toEqual([{ kind: 'orderOfPlay', tournamentId: 't-1' }]);
    expect(() => recordOrderOfPlay(undefined, [{ tournamentId: 't-1' }])).not.toThrow();
  });

  it('recordSchedulingProfile carries the profile in the intent', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordSchedulingProfile(buffer, [{ tournamentId: 't-1', schedulingProfile: [{ scheduleDate: '2025-01-05' }] }]);
    expect(buffer.intents).toContainEqual({
      kind: 'schedulingProfile',
      tournamentId: 't-1',
      schedulingProfile: [{ scheduleDate: '2025-01-05' }],
    });
  });

  it('recordSeeds records a seeds intent per structure (falls back to sole tournamentId)', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordSeeds(buffer, [{ drawId: 'd1', structureId: 's1' }]); // payload omits tournamentId
    expect(buffer.intents).toContainEqual({ kind: 'seeds', tournamentId: 't-1', structureId: 's1' });
  });

  it('recordSeeds skips a notice with no structureId and is a no-op when the buffer is off', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordSeeds(buffer, [{ tournamentId: 't-1' }]);
    expect(buffer.intents).toHaveLength(0);
    expect(() => recordSeeds(undefined, [{ tournamentId: 't-1', structureId: 's1' }])).not.toThrow();
  });

  it('recordDeleteMatchUps records a deleteMatchUps intent carrying the matchUpIds', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordDeleteMatchUps(buffer, [{ tournamentId: 't-1', matchUpIds: ['m1', 'm2'] }]);
    expect(buffer.intents).toContainEqual({ kind: 'deleteMatchUps', tournamentId: 't-1', matchUpIds: ['m1', 'm2'] });
  });

  it('recordDeleteMatchUps skips a notice with no matchUpIds and is a no-op when the buffer is off', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordDeleteMatchUps(buffer, [{ tournamentId: 't-1', matchUpIds: [] }]);
    expect(buffer.intents).toHaveLength(0);
    expect(() => recordDeleteMatchUps(undefined, [{ tournamentId: 't-1', matchUpIds: ['m1'] }])).not.toThrow();
  });

  it('recordPersonClaims records a claim only for a participant carrying the CANONICAL_PERSON stamp', () => {
    const buffer = createDeltaBuffer(['t-1']);
    recordPersonClaims(
      buffer,
      [
        {
          tournamentId: 't-1',
          participants: [
            { participantId: 'pa-1', person: { personOtherIds: [{ organisationId: 'USTA', personId: '5' }, { organisationId: 'CANONICAL_PERSON', personId: 'canon-9' }] } },
            { participantId: 'pa-2', person: { personOtherIds: [{ organisationId: 'USTA', personId: '6' }] } },
          ],
        },
      ],
      'CANONICAL_PERSON',
    );
    const claims = buffer.intents.filter((i) => i.kind === 'claimPerson');
    expect(claims).toEqual([{ kind: 'claimPerson', tournamentId: 't-1', participantId: 'pa-1', personId: 'canon-9' }]);
  });
});
