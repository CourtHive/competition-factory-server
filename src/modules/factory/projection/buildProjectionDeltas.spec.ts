import { buildProjectionDeltas } from './buildProjectionDeltas';
import { ProjectionIntent } from './projectionTypes';

const RECORD = {
  tournamentId: 't-1',
  tournamentName: 'Spring Open',
  parentOrganisation: { organisationId: 'BOBOCA' },
  startDate: '2026-05-01',
  endDate: '2026-05-03',
  events: [{ eventId: 'e1', drawDefinitions: [{ drawId: 'd1' }, { drawId: 'd2' }] }],
};
const RECORDS = { 't-1': RECORD };

function singlesMatchUp(matchUpId: string, drawId: string) {
  return {
    matchUpId,
    matchUpType: 'SINGLES',
    matchUpStatus: 'COMPLETED',
    winningSide: 1,
    drawId,
    eventId: 'e1',
    score: { scoreStringSide1: '6-1 6-1' },
    sides: [
      { sideNumber: 1, participant: { participantId: 'p1', participantType: 'INDIVIDUAL', participantName: 'A', person: { personId: '1001' } } },
      { sideNumber: 2, participant: { participantId: 'p2', participantType: 'INDIVIDUAL', participantName: 'B' } },
    ],
  };
}

async function build(intents: ProjectionIntent[], flattenDraw = jest.fn().mockResolvedValue([])) {
  return buildProjectionDeltas({ intents, tournamentRecords: RECORDS, flattenDraw });
}

describe('buildProjectionDeltas', () => {
  it('flattenDraw → tournaments + match_ups + competitor upserts (FK-ordered)', async () => {
    const flattenDraw = jest.fn().mockResolvedValue([singlesMatchUp('m1', 'd1')]);
    const deltas = await build([{ kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd1' }], flattenDraw);

    expect(flattenDraw).toHaveBeenCalledWith('t-1', 'd1');
    const tables = deltas.map((d) => `${d.op}:${d.table}`);
    // tournaments (parent) before match_ups before competitors
    expect(tables).toEqual(['upsert:tournaments', 'upsert:match_ups', 'upsert:match_up_competitors', 'upsert:match_up_competitors']);
    expect(deltas[0].row).toMatchObject({ tournament_id: 't-1', provider_id: 'BOBOCA' });
    expect(deltas[1].key).toEqual({ match_up_id: 'm1' });
  });

  it('deduplicates the same draw flattened twice', async () => {
    const flattenDraw = jest.fn().mockResolvedValue([]);
    await build(
      [
        { kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd1' },
        { kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd1' },
      ],
      flattenDraw,
    );
    expect(flattenDraw).toHaveBeenCalledTimes(1);
  });

  it('republishEvent resolves to the event drawIds and flattens each', async () => {
    const flattenDraw = jest.fn().mockResolvedValue([]);
    await build([{ kind: 'republishEvent', tournamentId: 't-1', eventId: 'e1' }], flattenDraw);
    expect(flattenDraw.mock.calls.map((c) => c[1]).sort()).toEqual(['d1', 'd2']);
  });

  it('MODIFY_MATCHUP result → slim match_ups upsert when NOT covered by a flatten', async () => {
    const matchUp = { matchUpId: 'm9', matchUpStatus: 'COMPLETED', winningSide: 1, score: { scoreStringSide1: '7-5' } };
    const deltas = await build([{ kind: 'matchUpResult', tournamentId: 't-1', matchUp }]);
    const resultDelta = deltas.find((d) => d.table === 'match_ups');
    expect(resultDelta).toMatchObject({ op: 'upsert', topic: 'modifyMatchUp', key: { match_up_id: 'm9' } });
    expect(resultDelta?.row).toMatchObject({ match_up_status: 'COMPLETED', score_string: '7-5' });
  });

  it('skips the slim result when the same matchUp was fully built by a flatten', async () => {
    const flattenDraw = jest.fn().mockResolvedValue([singlesMatchUp('m1', 'd1')]);
    const deltas = await build(
      [
        { kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd1' },
        { kind: 'matchUpResult', tournamentId: 't-1', matchUp: { matchUpId: 'm1', matchUpStatus: 'X' } },
      ],
      flattenDraw,
    );
    // only ONE match_ups upsert (from the flatten), no duplicate slim update for m1
    expect(deltas.filter((d) => d.table === 'match_ups')).toHaveLength(1);
    expect(deltas.find((d) => d.table === 'match_ups')?.topic).toBe('flattenDraw');
  });

  it('venue → venues + tournament_venues upserts', async () => {
    const deltas = await build([{ kind: 'venue', tournamentId: 't-1', venue: { venueId: 'v1', venueName: 'Center' } }]);
    const tables = deltas.map((d) => `${d.op}:${d.table}`);
    expect(tables).toContain('upsert:venues');
    expect(tables).toContain('upsert:tournament_venues');
  });

  it('delete intents → delete deltas with WHERE-clause keys', async () => {
    const deltas = await build([
      { kind: 'deleteDraw', tournamentId: 't-1', drawId: 'd1' },
      { kind: 'deleteEvent', tournamentId: 't-1', eventId: 'e1' },
      { kind: 'deleteVenue', tournamentId: 't-1', venueId: 'v1' },
      { kind: 'deleteParticipants', tournamentId: 't-1', participantIds: ['p1', 'p2'] },
    ]);
    const deletes = deltas.filter((d) => d.op === 'delete');
    expect(deletes).toEqual(
      expect.arrayContaining([
        { tournamentId: 't-1', op: 'delete', table: 'match_ups', key: { draw_id: 'd1' }, topic: 'deleteDraw' },
        { tournamentId: 't-1', op: 'delete', table: 'match_ups', key: { event_id: 'e1' }, topic: 'deleteEvent' },
        { tournamentId: 't-1', op: 'delete', table: 'entries', key: { tournament_id: 't-1', event_id: 'e1' }, topic: 'deleteEvent' },
        { tournamentId: 't-1', op: 'delete', table: 'tournament_venues', key: { tournament_id: 't-1', venue_id: 'v1' }, topic: 'deleteVenue' },
        { tournamentId: 't-1', op: 'delete', table: 'entries', key: { tournament_id: 't-1', participant_id: 'p1' }, topic: 'deleteParticipants' },
        { tournamentId: 't-1', op: 'delete', table: 'entries', key: { tournament_id: 't-1', participant_id: 'p2' }, topic: 'deleteParticipants' },
      ]),
    );
  });

  it('participants intent → entries upserts + a tournaments upsert (FK parent)', async () => {
    const records = {
      't-1': { ...RECORD, participants: [{ participantId: 'p1', person: { personId: '1001' } }], events: [{ eventId: 'e1', entries: [{ participantId: 'p1', entryStatus: 'ACCEPTED' }] }] },
    };
    const deltas = await buildProjectionDeltas({ intents: [{ kind: 'participants', tournamentId: 't-1' }], tournamentRecords: records, flattenDraw: jest.fn() });
    expect(deltas.some((d) => d.table === 'tournaments')).toBe(true);
    expect(deltas.find((d) => d.table === 'entries')).toMatchObject({ op: 'upsert', row: { participant_id: 'p1', person_id: '1001' } });
  });

  it('deleteMatchUps intent → a match_ups delete per matchUpId (competitors cascade)', async () => {
    const deltas = await build([{ kind: 'deleteMatchUps', tournamentId: 't-1', matchUpIds: ['m1', 'm2'] }]);
    const deletes = deltas.filter((d) => d.op === 'delete');
    expect(deletes).toEqual([
      { tournamentId: 't-1', op: 'delete', table: 'match_ups', key: { match_up_id: 'm1' }, topic: 'deletedMatchUpIds' },
      { tournamentId: 't-1', op: 'delete', table: 'match_ups', key: { match_up_id: 'm2' }, topic: 'deletedMatchUpIds' },
    ]);
  });

  it('does NOT delete a matchUp that was also (re)built this cycle — draw-replace hazard guard', async () => {
    // A draw replace fires delete(old ids) + flatten(new ids) for the SAME matchUpId.
    // The flatten upsert must win; the delete (emitted last) must be skipped.
    const flattenDraw = jest.fn().mockResolvedValue([singlesMatchUp('m1', 'd1')]);
    const deltas = await build(
      [
        { kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd1' },
        { kind: 'deleteMatchUps', tournamentId: 't-1', matchUpIds: ['m1'] },
      ],
      flattenDraw,
    );
    expect(deltas.some((d) => d.op === 'delete' && d.key?.match_up_id === 'm1')).toBe(false);
    expect(deltas.some((d) => d.op === 'upsert' && d.table === 'match_ups' && d.key?.match_up_id === 'm1')).toBe(true);
  });

  it('deleteMatchUps still deletes a matchUp that was NOT rebuilt this cycle', async () => {
    const flattenDraw = jest.fn().mockResolvedValue([singlesMatchUp('m1', 'd1')]);
    const deltas = await build(
      [
        { kind: 'flattenDraw', tournamentId: 't-1', drawId: 'd1' },
        { kind: 'deleteMatchUps', tournamentId: 't-1', matchUpIds: ['m9'] }, // m9 not flattened
      ],
      flattenDraw,
    );
    expect(deltas.some((d) => d.op === 'delete' && d.key?.match_up_id === 'm9')).toBe(true);
  });

  it('entries intent → entries upserts WITHOUT forcing a tournaments upsert', async () => {
    const records = {
      't-1': {
        ...RECORD,
        events: [{ eventId: 'e1', entries: [{ participantId: 'p1', entryStatus: 'ALTERNATE' }] }],
      },
    };
    const deltas = await buildProjectionDeltas({
      intents: [{ kind: 'entries', tournamentId: 't-1' }],
      tournamentRecords: records,
      flattenDraw: jest.fn(),
    });
    expect(deltas.find((d) => d.table === 'entries')).toMatchObject({
      op: 'upsert',
      row: { participant_id: 'p1', entry_status: 'ALTERNATE' },
    });
    // a pure entry change must NOT emit a tournaments upsert (unlike `participants`)
    expect(deltas.some((d) => d.table === 'tournaments')).toBe(false);
  });

  it('claimPerson → update deltas stamping person_id on competitors + entries', async () => {
    const deltas = await build([{ kind: 'claimPerson', tournamentId: 't-1', participantId: 'pa-1', personId: 'canon-9' }]);
    const updates = deltas.filter((d) => d.op === 'update');
    expect(updates).toEqual([
      {
        tournamentId: 't-1',
        op: 'update',
        table: 'match_up_competitors',
        key: { individual_participant_id: 'pa-1' },
        row: { person_id: 'canon-9', link_source: 'canonical' },
        topic: 'claimPerson',
      },
      {
        tournamentId: 't-1',
        op: 'update',
        table: 'entries',
        key: { tournament_id: 't-1', participant_id: 'pa-1' },
        row: { person_id: 'canon-9' },
        topic: 'claimPerson',
      },
    ]);
  });

  it('returns nothing for an empty intent buffer', async () => {
    expect(await build([])).toEqual([]);
  });
});
