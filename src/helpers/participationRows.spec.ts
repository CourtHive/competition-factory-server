import { describe, expect, it } from 'vitest';

import { deriveParticipationRows } from './participationRows';

const ITA = 'ita-org';

const team = (participantId: string, issuedId?: string) => ({
  participantType: 'TEAM',
  participantId,
  participantName: `Team ${participantId}`,
  ...(issuedId ? { participantOtherIds: [{ organisationId: ITA, participantId: issuedId }] } : {}),
});

const dual = (participants: any[]) => ({
  tournamentId: 'dual-1',
  tournamentName: 'A vs B',
  startDate: '2026-03-28',
  endDate: '2026-03-28',
  parentOrganisation: { organisationId: ITA },
  events: [{ eventId: 'dual' }],
  participants,
});

describe('deriveParticipationRows', () => {
  it('reports BOTH sides of a fixture, which is the point of participation', () => {
    // Calendar membership can name only one owner; a dual belongs to two programmes. If this
    // returned one row, a visiting team's season would be missing every away fixture.
    const rows = deriveParticipationRows(dual([team('local-a', 'ita-A'), team('local-b', 'ita-B')]));
    expect(rows.map((row) => row.subjectId).sort((a, b) => a.localeCompare(b, 'en'))).toEqual(['ita-A', 'ita-B']);
    expect(rows.every((row) => row.subjectType === 'TEAM')).toBe(true);
  });

  it('keys the subject on the ISSUED id, not the tournament-local participantId', () => {
    // The same programme carries a different participantId in every record, so indexing on it would
    // give each team a season of exactly one fixture — plausible, and wrong.
    const rows = deriveParticipationRows(dual([team('local-a', 'ita-A')]));
    expect(rows[0].subjectId).toBe('ita-A');
    expect(rows[0].participantId).toBe('local-a');
  });

  it('carries the fields a schedule renders from, so reading one needs no record load', () => {
    const rows = deriveParticipationRows(dual([team('local-a', 'ita-A')]));
    expect(rows[0]).toMatchObject({
      tournamentId: 'dual-1',
      tournamentName: 'A vs B',
      startDate: '2026-03-28',
      endDate: '2026-03-28',
      providerId: ITA,
      eventCount: 1,
    });
  });

  it('contributes NO row for a team stating no durable identity', () => {
    // A recorded gap. Falling back to the local participantId would manufacture a subject that can
    // never join to anything, and it would look exactly like a real one.
    const rows = deriveParticipationRows(dual([team('local-a'), team('local-b', 'ita-B')]));
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectId).toBe('ita-B');
  });

  it('ignores non-TEAM participants', () => {
    const record = dual([team('local-a', 'ita-A')]);
    record.participants.push({ participantType: 'INDIVIDUAL', participantId: 'p1' } as any);
    expect(deriveParticipationRows(record)).toHaveLength(1);
  });

  it('returns nothing rather than throwing on a record with no id or no participants', () => {
    expect(deriveParticipationRows({ participants: [] })).toEqual([]);
    expect(deriveParticipationRows({ tournamentId: 'x' })).toEqual([]);
    expect(deriveParticipationRows(undefined)).toEqual([]);
  });
});
