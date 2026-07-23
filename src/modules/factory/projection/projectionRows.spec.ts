import { entryRows, matchUpResultRow, matchUpRowSet, tournamentRow, venueRow, MatchUpRowContext } from './projectionRows';

const CTX: MatchUpRowContext = { tournamentId: 't-1', providerId: 'BOBOCA', published: true };

function singlesSide(sideNumber: number, participantId: string, name: string, personId?: string) {
  return {
    sideNumber,
    participantId,
    participant: { participantId, participantType: 'INDIVIDUAL', participantName: name, person: personId ? { personId } : undefined },
  };
}

describe('projectionRows.matchUpRowSet', () => {
  it('projects a singles matchUp: one STANDARD row + per-individual competitors, winner-perspective score', () => {
    const matchUp = {
      matchUpId: 'm1',
      matchUpType: 'SINGLES',
      matchUpStatus: 'COMPLETED',
      winningSide: 2,
      score: { scoreStringSide1: '6-3 3-6 4-6', scoreStringSide2: '3-6 6-3 6-4' },
      roundName: 'F',
      roundNumber: 3,
      drawId: 'd1',
      eventId: 'e1',
      structureId: 's1',
      schedule: { scheduledDate: '2026-05-01', venueId: 'v9' },
      sides: [singlesSide(1, 'p1', 'Alice', '1001'), singlesSide(2, 'p2', 'Bob', 'p2')],
    };

    const { matchUpRows, competitorRows } = matchUpRowSet(matchUp, CTX);

    expect(matchUpRows).toHaveLength(1);
    expect(matchUpRows[0]).toMatchObject({
      match_up_id: 'm1',
      tournament_id: 't-1',
      provider_id: 'BOBOCA',
      match_up_level: 'STANDARD',
      event_type: 'SINGLES',
      parent_match_up_id: null,
      winning_side: 2,
      score_string: '3-6 6-3 6-4', // winner (side 2) perspective
      scheduled_date: '2026-05-01',
      venue_id: 'v9',
      published: true,
    });

    expect(competitorRows).toHaveLength(2);
    // Alice: real provider personId → populated
    expect(competitorRows[0]).toMatchObject({
      match_up_id: 'm1',
      side_number: 1,
      competitor_index: 0,
      participant_type: 'INDIVIDUAL',
      side_participant_id: 'p1',
      individual_participant_id: 'p1',
      person_id: '1001',
      link_source: 'providerId',
      participant_name: 'Alice',
    });
    // Bob: personId === participantId → unresolved
    expect(competitorRows[1]).toMatchObject({ person_id: null, link_source: 'unresolved', side_participant_id: 'p2' });
  });

  it('projects a doubles matchUp: two competitor rows per side (per individual)', () => {
    const pairSide = (sideNumber: number, pairId: string, a: any, b: any) => ({
      sideNumber,
      participantId: pairId,
      participant: {
        participantId: pairId,
        participantType: 'PAIR',
        participantName: 'Pair',
        individualParticipants: [a, b],
      },
    });
    const indiv = (participantId: string, name: string, personId?: string) => ({
      participantId,
      participantName: name,
      person: personId ? { personId } : undefined,
    });

    const matchUp = {
      matchUpId: 'dm1',
      matchUpType: 'DOUBLES',
      matchUpStatus: 'COMPLETED',
      winningSide: 1,
      score: { scoreStringSide1: '6-4 6-4', scoreStringSide2: '4-6 4-6' },
      sides: [
        pairSide(1, 'pair1', indiv('i1', 'A', '2001'), indiv('i2', 'B', '2002')),
        pairSide(2, 'pair2', indiv('i3', 'C', '2003'), indiv('i4', 'D', '2004')),
      ],
    };

    const { competitorRows } = matchUpRowSet(matchUp, CTX);
    expect(competitorRows).toHaveLength(4);
    expect(competitorRows.map((r) => [r.side_number, r.competitor_index, r.individual_participant_id, r.person_id])).toEqual([
      [1, 0, 'i1', '2001'],
      [1, 1, 'i2', '2002'],
      [2, 0, 'i3', '2003'],
      [2, 1, 'i4', '2004'],
    ]);
    expect(competitorRows.every((r) => r.side_participant_id.startsWith('pair'))).toBe(true);
  });

  it('projects a TEAM/dual matchUp: TIE row + RUBBER rows carrying the dual team_id', () => {
    const teamSide = (sideNumber: number, teamId: string, name: string) => ({
      sideNumber,
      participantId: teamId,
      participant: { participantId: teamId, participantType: 'TEAM', teamId, participantName: name },
    });
    const rubber = {
      matchUpId: 'r1',
      matchUpType: 'SINGLES',
      collectionId: 'c1',
      collectionPosition: 1,
      matchUpStatus: 'COMPLETED',
      winningSide: 1,
      sides: [singlesSide(1, 'pl1', 'Player1', '3001'), singlesSide(2, 'pl2', 'Player2', '3002')],
    };
    const teamMatchUp = {
      matchUpId: 'tm1',
      matchUpType: 'TEAM',
      matchUpStatus: 'COMPLETED',
      winningSide: 1,
      sides: [teamSide(1, 'teamA', 'Uni A'), teamSide(2, 'teamB', 'Uni B')],
      tieMatchUps: [rubber],
    };

    const { matchUpRows, competitorRows } = matchUpRowSet(teamMatchUp, CTX);

    const tie = matchUpRows.find((r) => r.match_up_id === 'tm1');
    const rub = matchUpRows.find((r) => r.match_up_id === 'r1');
    expect(tie).toMatchObject({ match_up_level: 'TIE', event_type: 'TEAM', parent_match_up_id: null });
    expect(rub).toMatchObject({ match_up_level: 'RUBBER', parent_match_up_id: 'tm1', collection_id: 'c1', collection_position: 1 });

    // team competitor rows carry team_id = their own id
    const teamCompetitors = competitorRows.filter((r) => r.match_up_id === 'tm1');
    expect(teamCompetitors.map((r) => [r.side_number, r.team_id, r.participant_type])).toEqual([
      [1, 'teamA', 'TEAM'],
      [2, 'teamB', 'TEAM'],
    ]);

    // rubber player competitor rows carry the dual's team_id from the parent side
    const rubberCompetitors = competitorRows.filter((r) => r.match_up_id === 'r1');
    expect(rubberCompetitors.map((r) => [r.side_number, r.individual_participant_id, r.team_id, r.person_id])).toEqual([
      [1, 'pl1', 'teamA', '3001'],
      [2, 'pl2', 'teamB', '3002'],
    ]);
  });

  it('emits no competitor rows for a BYE side (no participant)', () => {
    const matchUp = {
      matchUpId: 'bye1',
      matchUpType: 'SINGLES',
      matchUpStatus: 'BYE',
      sides: [singlesSide(1, 'p1', 'Alice', '1001'), { sideNumber: 2 }],
    };
    const { competitorRows } = matchUpRowSet(matchUp, CTX);
    expect(competitorRows).toHaveLength(1);
    expect(competitorRows[0].side_number).toBe(1);
  });
});

describe('projectionRows other builders', () => {
  it('tournamentRow maps identity + provider + dates', () => {
    const record = {
      tournamentId: 't-1',
      tournamentName: 'Spring Open',
      parentOrganisation: { organisationId: 'BOBOCA' },
      startDate: '2026-05-01',
      endDate: '2026-05-03',
    };
    expect(tournamentRow(record)).toMatchObject({
      tournament_id: 't-1',
      tournament_name: 'Spring Open',
      provider_id: 'BOBOCA',
      start_date: '2026-05-01',
      end_date: '2026-05-03',
    });
  });

  it('venueRow flattens the first address', () => {
    const venue = {
      venueId: 'v1',
      venueName: 'Center',
      facilityId: 'fac-1',
      addresses: [{ addressLine1: '1 Main St', city: 'Town', postalCode: '00000' }],
    };
    expect(venueRow(venue)).toEqual({
      venue_id: 'v1',
      venue_name: 'Center',
      facility_id: 'fac-1',
      address: '1 Main St, Town, 00000',
    });
  });

  it('entryRows projects each event entry with person resolution', () => {
    const record = {
      tournamentId: 't-1',
      parentOrganisation: { organisationId: 'BOBOCA' },
      participants: [
        { participantId: 'p1', person: { personId: '1001' } },
        { participantId: 'p2', person: { personId: 'p2' } },
      ],
      events: [
        { eventId: 'e1', entries: [{ participantId: 'p1', entryStatus: 'ACCEPTED' }, { participantId: 'p2', entryStatus: 'ALTERNATE' }] },
      ],
    };
    const rows = entryRows(record);
    expect(rows).toEqual([
      { tournament_id: 't-1', event_id: 'e1', participant_id: 'p1', person_id: '1001', provider_id: 'BOBOCA', entry_status: 'ACCEPTED' },
      { tournament_id: 't-1', event_id: 'e1', participant_id: 'p2', person_id: null, provider_id: 'BOBOCA', entry_status: 'ALTERNATE' },
    ]);
  });

  it('matchUpResultRow builds a slim result update', () => {
    const matchUp = {
      matchUpId: 'm1',
      matchUpStatus: 'COMPLETED',
      winningSide: 1,
      score: { scoreStringSide1: '6-0 6-0', scoreStringSide2: '0-6 0-6' },
    };
    expect(matchUpResultRow(matchUp, 't-1', 'BOBOCA')).toEqual({
      match_up_id: 'm1',
      tournament_id: 't-1',
      provider_id: 'BOBOCA',
      match_up_status: 'COMPLETED',
      winning_side: 1,
      score_string: '6-0 6-0',
      scheduled_date: null,
    });
  });
});
