import { describe, expect, it } from 'vitest';

import { fromRow, toRow } from './calendarTournamentRow';

/**
 * The cutover's central claim is that migration 047 changes WHERE a calendar entry is
 * stored and not WHAT it contains. These assert that as a round-trip property.
 */

const PROVIDER_ID = 'provider-a';
const PROVIDER_ABBR = 'AAA';

/** The shape measured against the built factory — sparse, because definedAttributes strips undefined. */
function realisticEntry(overrides: any = {}) {
  return {
    tournamentId: 't-1',
    providerId: PROVIDER_ID,
    searchText: 'wimbledon',
    published: true,
    createdByUserId: 'user-1',
    tournament: {
      tournamentId: 't-1',
      tournamentName: 'Wimbledon',
      startDate: '2026-06-29',
      endDate: '2026-07-12',
      eventInfo: [{ eventId: 'e-1', eventName: 'MS' }],
      publishState: { status: { published: true, publishedEventIds: ['e-1'] } },
      timeItemValues: { TMX: { offline: false } },
      tournamentContacts: [],
      venues: [{ venueId: 'v-1', venueName: 'Centre Court' }],
      ...overrides,
    },
  };
}

describe('calendarTournamentRow', () => {
  describe('round trip', () => {
    it('returns an entry equal to the original', () => {
      const entry = realisticEntry();
      expect(fromRow(toRow(entry, PROVIDER_ID, PROVIDER_ABBR))).toEqual(entry);
    });

    it('preserves a rich entry carrying every mapped field', () => {
      const entry = realisticEntry({
        formalName: 'The Championships',
        promotionalName: 'Wimbledon 2026',
        tournamentLevel: 'INTERNATIONAL',
        tournamentRank: 1,
        tournamentTier: { system: 'ITF', value: 'Grand Slam', numericRank: 1 },
        hostCountryCode: 'GBR',
        localTimeZone: 'Europe/London',
        activeDates: ['2026-06-29', '2026-06-30'],
        updatedAt: '2026-06-01T10:00:00Z',
        parentOrganisation: { organisationId: PROVIDER_ID, organisationName: 'AELTC' },
        tournamentStatus: 'ACTIVE',
        tournamentImageURL: 'https://example.test/w.png',
        onlineResources: [{ name: 'tournamentImage', identifier: 'https://example.test/w.png' }],
        registrationProfile: { entryFees: [{ amount: 50, currency: 'GBP' }] },
        tournamentAddress: { city: 'London' },
        notes: 'grass',
      });
      expect(fromRow(toRow(entry, PROVIDER_ID, PROVIDER_ABBR))).toEqual(entry);
    });

    it('does not invent keys for fields the entry never had', () => {
      const entry = realisticEntry();
      const back = fromRow(toRow(entry, PROVIDER_ID, PROVIDER_ABBR));
      expect(Object.keys(back.tournament).sort()).toEqual(Object.keys(entry.tournament).sort());
      expect('notes' in back.tournament).toBe(false);
      expect('registrationProfile' in back.tournament).toBe(false);
    });

    it('carries an UNKNOWN upstream field through `remainder` rather than losing it', () => {
      const entry = realisticEntry({ someFutureFactoryField: { nested: ['value'] } });
      const row = toRow(entry, PROVIDER_ID, PROVIDER_ABBR);

      // It is not silently dropped...
      expect(row.remainder).toEqual({ someFutureFactoryField: { nested: ['value'] } });
      // ...and it does not leak into a PUBLIC column on the way.
      expect(row.identity ?? {}).not.toHaveProperty('someFutureFactoryField');
      expect(fromRow(row)).toEqual(entry);
    });

    it('lets a mapped column win over a stale copy left in remainder', () => {
      const row = toRow(realisticEntry(), PROVIDER_ID, PROVIDER_ABBR);
      const stale = { ...row, remainder: { tournamentName: 'STALE NAME' } };
      expect(fromRow(stale).tournament.tournamentName).toBe('Wimbledon');
    });
  });

  describe('promoted columns', () => {
    it('counts events at write time so a list never opens event_info', () => {
      expect(toRow(realisticEntry(), PROVIDER_ID).event_count).toBe(1);
    });

    it('promotes the offline flag out of timeItemValues', () => {
      expect(toRow(realisticEntry({ timeItemValues: { TMX: { offline: true } } }), PROVIDER_ID).offline).toBe(true);
    });

    it('truncates a full timestamp to a calendar day', () => {
      const row = toRow(realisticEntry({ startDate: '2026-06-29T00:00:00.000Z' }), PROVIDER_ID);
      expect(row.start_date).toBe('2026-06-29');
    });

    it('stores an unparseable date as NULL rather than a wrong day', () => {
      expect(toRow(realisticEntry({ startDate: 'not-a-date' }), PROVIDER_ID).start_date).toBeNull();
    });

    it('takes the tenant key from the ARGUMENT, never from the entry', () => {
      // The entry's own providerId is what drifts; the caller resolved the real one.
      const entry = realisticEntry();
      entry.providerId = 'stale-provider-from-the-blob';
      expect(toRow(entry, PROVIDER_ID).provider_id).toBe(PROVIDER_ID);
    });

    it('derives searchText when the entry omits it', () => {
      const entry: any = realisticEntry();
      delete entry.searchText;
      expect(toRow(entry, PROVIDER_ID).search_text).toBe('wimbledon');
    });
  });

  describe('published is strict', () => {
    it.each([
      ['absent', undefined],
      ['a truthy non-boolean', 'yes' as any],
      ['false', false],
    ])('reads %s as NOT published', (_label, published) => {
      const entry: any = realisticEntry();
      entry.published = published;
      expect(toRow(entry, PROVIDER_ID).published).toBe(false);
      expect(fromRow(toRow(entry, PROVIDER_ID)).published).toBe(false);
    });

    it('survives the round trip as true only when it was exactly true', () => {
      expect(fromRow(toRow(realisticEntry(), PROVIDER_ID)).published).toBe(true);
    });
  });

  describe('empty objects', () => {
    // Regression: collapsing {} to NULL was the first implementation, and the
    // real-factory round-trip below caught it — a live entry carries `timeItemValues: {}`.
    it('preserves an empty object rather than collapsing it to NULL', () => {
      const entry = realisticEntry({ registrationProfile: {} });
      expect(toRow(entry, PROVIDER_ID).registration_profile).toEqual({});
      expect(fromRow(toRow(entry, PROVIDER_ID))).toEqual(entry);
    });

    it('keeps an empty ARRAY, which is meaningful (no contacts is not unknown contacts)', () => {
      expect(toRow(realisticEntry(), PROVIDER_ID).tournament_contacts).toEqual([]);
    });
  });
});

/**
 * The tests above use a hand-built fixture, which can only ever confirm what its author
 * already believed the shape was. This one round-trips an entry the FACTORY produced, so a
 * change to `getTournamentCalendarEntry` that introduces a field this module does not know
 * about is caught here rather than in production.
 */
describe('fidelity against a real factory entry', () => {
  it('round-trips an entry built by getTournamentCalendarEntry', async () => {
    const { mocksEngine, tournamentEngine, queryGovernor }: any = await import('tods-competition-factory');

    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      eventProfiles: [{ eventName: 'Main', drawProfiles: [{ drawSize: 8 }] }],
      venueProfiles: [{ venueName: 'Centre', courtsCount: 4 }],
    });
    // Production entries always carry one: addToOrUpdateCalendar runs only when the record
    // has a parentOrganisation, which is what getTournamentCalendarEntry reads providerId from.
    tournamentRecord.parentOrganisation = { organisationId: PROVIDER_ID, organisationName: 'A' };
    tournamentEngine.setState(tournamentRecord);
    tournamentEngine.publishEvent({ eventId: tournamentEngine.getEvents().events[0].eventId });
    const record = tournamentEngine.getTournament().tournamentRecord;

    // Mirrors CFS's getCalendarEntry: the factory entry plus the two server-side stamps.
    const entry = {
      ...queryGovernor.getTournamentCalendarEntry({ tournamentRecord: record }),
      createdByUserId: 'user-1',
      published: true,
    };

    const back = fromRow(toRow(entry, PROVIDER_ID, PROVIDER_ABBR));

    // `tournamentImageURL` is present-but-undefined on the factory entry and absent after
    // the round trip. `toEqual` treats those as equal, which is the right comparison here:
    // JSON storage cannot preserve the distinction and no consumer can observe it.
    expect(back).toEqual(entry);
  });

  it('leaves `remainder` empty — every real field has a home', async () => {
    const { mocksEngine, tournamentEngine, queryGovernor }: any = await import('tods-competition-factory');

    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      eventProfiles: [{ eventName: 'Main', drawProfiles: [{ drawSize: 8 }] }],
      venueProfiles: [{ venueName: 'Centre', courtsCount: 4 }],
    });
    tournamentRecord.parentOrganisation = { organisationId: PROVIDER_ID, organisationName: 'A' };
    tournamentEngine.setState(tournamentRecord);
    const record = tournamentEngine.getTournament().tournamentRecord;
    const entry = queryGovernor.getTournamentCalendarEntry({ tournamentRecord: record });

    // A non-empty remainder is not a failure — it is the catch-all doing its job — but it
    // means the factory grew a field worth classifying. Fail loudly so someone decides
    // whether it is PUBLIC, rather than letting it sit private by default forever.
    const unclassified = Object.keys(toRow(entry, PROVIDER_ID).remainder ?? {});
    expect(unclassified, `unclassified calendar-entry field(s) — classify in 047: ${unclassified}`).toEqual([]);
  });
});

/**
 * Regression: the `pg` driver maps a DATE column to a JS `Date` at LOCAL midnight, so a row
 * read back carried an instant where every consumer expects a calendar-day string. Caught
 * only by running real SQL — the mocked-pool specs returned the strings they were handed.
 *
 * `SELECT_COLUMNS` now casts to text so the coercion never happens; this pins the defensive
 * half, which matters for any caller that reads the column another way.
 */
describe('DATE columns are calendar days, not instants', () => {
  it('converts a driver-supplied Date to its LOCAL calendar day', () => {
    // Local midnight on the 29th — what pg constructs for DATE '2026-06-29'.
    const row: any = { tournament_id: 't-1', provider_id: 'p', search_text: '', published: true };
    row.start_date = new Date(2026, 5, 29, 0, 0, 0);
    row.end_date = new Date(2026, 6, 12, 0, 0, 0);

    const entry = fromRow(row);

    expect(entry.tournament.startDate).toBe('2026-06-29');
    expect(entry.tournament.endDate).toBe('2026-07-12');
  });

  it('does NOT use toISOString, which reports the previous day EAST of UTC', () => {
    // Direction measured rather than reasoned about: getTimezoneOffset() is minutes WEST of
    // UTC, so a NEGATIVE offset is east. Local midnight 2026-06-29 serialises as 2026-06-28
    // in Asia/Tokyo (-540) and Pacific/Auckland (-720); America/New_York (+240) and UTC are
    // unaffected. An earlier version of this test asserted the opposite direction and failed.
    const row: any = { tournament_id: 't-1', provider_id: 'p', search_text: '', published: true };
    row.start_date = new Date(2026, 5, 29, 0, 0, 0);

    const actual = fromRow(row).tournament.startDate;
    expect(actual).toBe('2026-06-29');

    // Only east-of-UTC hosts can observe the divergence; elsewhere the two agree and the
    // assertion above is the whole guarantee.
    if (row.start_date.getTimezoneOffset() < 0) {
      expect(actual).not.toBe(row.start_date.toISOString().split('T')[0]);
    }
  });

  it('passes a plain date string straight through', () => {
    const row: any = {
      tournament_id: 't-1', provider_id: 'p', search_text: '', published: true, start_date: '2026-06-29',
    };
    expect(fromRow(row).tournament.startDate).toBe('2026-06-29');
  });

  it('omits the key entirely when the column is NULL', () => {
    const row: any = { tournament_id: 't-1', provider_id: 'p', search_text: '', published: true, start_date: null };
    expect('startDate' in fromRow(row).tournament).toBe(false);
  });
});
