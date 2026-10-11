import { stampSettlementAudit } from './stampSettlementAudit';

import type { Tournament } from 'tods-competition-factory';

const firstInstant = '2026-10-10T12:00:00.000Z';
const records = (): Record<string, Tournament> => ({
  t: { tournamentId: 't', events: [{ eventId: 'e', drawDefinitions: [{ drawId: 'd' }] }] },
});
const command = () => ({
  method: 'settleRotatingPartnerResult',
  params: { drawId: 'd', requestId: 'r', recordedBy: 'spoofed', recordedAt: '2000-01-01T00:00:00Z' },
});

it('replaces caller audit fields with verified identity and server time', () => {
  const directive = command();
  expect(
    stampSettlementAudit({
      methods: [directive],
      tournamentRecords: records(),
      actor: 'verified',
      recordedAt: firstInstant,
    }),
  ).toEqual({ stamped: true });
  expect(directive.params).toMatchObject({ recordedBy: 'verified', recordedAt: firstInstant });
});

it('uses the saved timestamp on retry but never borrows the saved actor', () => {
  const tournamentRecords = records();
  Object.assign(tournamentRecords.t.events![0].drawDefinitions![0], {
    competitionSettlements: [{ requestId: 'r', recordedBy: 'original', recordedAt: firstInstant }],
  });
  const directive = command();
  stampSettlementAudit({
    methods: [directive],
    tournamentRecords,
    actor: 'different-verified-actor',
    recordedAt: '2026-10-11T12:00:00.000Z',
  });
  expect(directive.params).toMatchObject({ recordedBy: 'different-verified-actor', recordedAt: firstInstant });
});

it('refuses missing authenticated identity without accepting client metadata', () => {
  const directive = command();
  const before = structuredClone(directive);
  expect(
    stampSettlementAudit({
      methods: [directive],
      tournamentRecords: records(),
      actor: undefined,
      recordedAt: firstInstant,
    }).error,
  ).toBeDefined();
  expect(directive).toEqual(before);
});

it('leaves ordinary commands unchanged', () => {
  const directive = { method: 'setTournamentName', params: { tournamentName: 'Open' } };
  const before = structuredClone(directive);
  expect(
    stampSettlementAudit({
      methods: [directive],
      tournamentRecords: records(),
      actor: undefined,
      recordedAt: firstInstant,
    }),
  ).toEqual({ stamped: false });
  expect(directive).toEqual(before);
});

it('refuses an ambiguous draw before factory execution', () => {
  const tournamentRecords = { ...records(), other: { ...records().t, tournamentId: 'other' } };
  expect(
    stampSettlementAudit({ methods: [command()], tournamentRecords, actor: 'verified', recordedAt: firstInstant })
      .error,
  ).toBeDefined();
});
