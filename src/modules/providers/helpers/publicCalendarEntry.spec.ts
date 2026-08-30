import { publicCalendar, publicCalendarEntry } from './publicCalendarEntry';

/**
 * A stored calendar entry, shaped as `getCalendarEntry()` actually produces it:
 * factory `getTournamentCalendarEntry()` (which spreads the whole
 * `getTournamentInfo` projection) plus the server's `createdByUserId` stamp.
 *
 * The private fields below are not hypothetical — each was verifiably served by
 * the unauthenticated `POST /provider/calendar` before 2026-08-29.
 */
const storedEntry = () => ({
  searchText: 'battle of boca',
  tournamentId: 'tid-1',
  providerId: 'prov-1',
  createdByUserId: 'a6f1c2d4-0000-4000-8000-000000000001',
  tournament: {
    tournamentId: 'tid-1',
    tournamentName: 'Battle of Boca',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    tournamentImageURL: 'https://example.test/logo.png',
    onlineResources: [{ resourceType: 'URL', identifier: 'https://example.test' }],
    tournamentStatus: 'ACTIVE',

    // --- must never reach an unauthenticated caller ---
    tournamentContacts: [{ participantName: 'Staffer', contacts: [{ value: 'staff@example.test' }] }],
    tournamentAddress: { addressLine1: '1 Court Way', city: 'Boca Raton' },
    venues: [{ venueId: 'v1', addresses: [{ addressLine1: '1 Court Way' }] }],
    notes: 'internal note: sponsor not confirmed',
    registrationProfile: { entryFees: [{ amount: 6000 }] },
  },
});

const PRIVATE_TOURNAMENT_FIELDS = [
  'tournamentContacts',
  'tournamentAddress',
  'venues',
  'notes',
  'registrationProfile',
];

describe('publicCalendarEntry', () => {
  it('drops every private field from the tournament projection', () => {
    const result = publicCalendarEntry(storedEntry());
    for (const field of PRIVATE_TOURNAMENT_FIELDS) {
      expect(result.tournament).not.toHaveProperty(field);
    }
  });

  it('drops the createdByUserId ownership stamp', () => {
    expect(publicCalendarEntry(storedEntry())).not.toHaveProperty('createdByUserId');
  });

  it('preserves the fields courthive-public actually renders', () => {
    const result = publicCalendarEntry(storedEntry());
    expect(result.tournamentId).toBe('tid-1');
    expect(result.searchText).toBe('battle of boca');
    expect(result.providerId).toBe('prov-1');
    expect(result.tournament.tournamentName).toBe('Battle of Boca');
    expect(result.tournament.startDate).toBe('2026-09-01');
    expect(result.tournament.tournamentImageURL).toBe('https://example.test/logo.png');
    expect(result.tournament.onlineResources).toHaveLength(1);
  });

  // The allow-list exists so that a field added upstream is excluded by default.
  // A deny-list would pass this test only until the next `getTournamentInfo` field.
  it('excludes an unknown field it has never seen', () => {
    const entry = storedEntry();
    (entry.tournament as any).someFutureInternalField = 'leaked';
    (entry as any).someFutureTopLevelField = 'leaked';

    const result = publicCalendarEntry(entry);
    expect(result.tournament).not.toHaveProperty('someFutureInternalField');
    expect(result).not.toHaveProperty('someFutureTopLevelField');
  });

  it('does not throw on a malformed or empty entry', () => {
    expect(publicCalendarEntry(undefined)).toEqual({ tournament: {} });
    expect(publicCalendarEntry({})).toEqual({ tournament: {} });
  });

  it('omits undefined fields rather than emitting explicit undefined keys', () => {
    const result = publicCalendarEntry({ tournamentId: 'tid-2', tournament: { tournamentName: 'X' } });
    expect(Object.keys(result)).toEqual(['tournamentId', 'tournament']);
    expect(Object.keys(result.tournament)).toEqual(['tournamentName']);
  });
});

describe('publicCalendar', () => {
  it('reduces the provider record to public identity only', () => {
    const result = publicCalendar({
      provider: {
        organisationId: 'prov-1',
        organisationName: 'Boca',
        organisationAbbreviation: 'BOCA',
        settings: { apiKey: 'super-secret' },
        internalNotes: 'do not ship',
      },
      tournaments: [storedEntry()],
    });

    expect(result.provider).toEqual({
      organisationId: 'prov-1',
      organisationName: 'Boca',
      organisationAbbreviation: 'BOCA',
    });
    expect(result.provider).not.toHaveProperty('settings');
    expect(result.provider).not.toHaveProperty('internalNotes');
  });

  it('projects every tournament, not just the first', () => {
    const result = publicCalendar({ provider: {}, tournaments: [storedEntry(), storedEntry()] });
    expect(result.tournaments).toHaveLength(2);
    for (const entry of result.tournaments) {
      expect(entry.tournament).not.toHaveProperty('tournamentContacts');
    }
  });

  it('returns an empty tournament list for a calendar with none', () => {
    expect(publicCalendar({ provider: {} }).tournaments).toEqual([]);
    expect(publicCalendar(undefined).tournaments).toEqual([]);
  });
});
