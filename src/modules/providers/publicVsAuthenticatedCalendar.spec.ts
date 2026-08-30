import { ProvidersService } from './providers.service';

/**
 * The public and authenticated calendar routes read the SAME stored entry object.
 * Since `getCalendarEntry()` began stamping `published`, the only thing separating
 * them is that `getCalendar` projects through `publicCalendar()` and
 * `getProviderCalendar` does not.
 *
 * That is a one-line difference guarding a real entitlement, so it is asserted
 * explicitly rather than left to inspection — requested by the ingest session in
 * `Mentat/in-flight/NOTE-2026-08-30-public-calendar-filter-meets-the-loaded-corpus.md`,
 * which measured the consequence on Button: 5,741 calendar entries, of which 5,640
 * (ITA + TE) are unpublished. The public calendar there goes to 95. A provider admin
 * must still see all 5,741.
 *
 * No database: `getCalendar` and `getProviderCalendar` touch only `calendarStorage`.
 */

const PUBLISHED = {
  published: true,
  tournamentId: 'pub-1',
  tournament: { tournamentName: 'Published Open', startDate: '2026-09-01', notes: 'internal' },
};

// Shaped like ITA/TE on Button: a real entry with nothing published yet.
const UNPUBLISHED = {
  published: false,
  tournamentId: 'draft-1',
  tournament: { tournamentName: 'ITA Team Season', startDate: '2026-09-01', notes: 'internal' },
};

function serviceWithCalendar(tournaments: any[]) {
  const calendarStorage = {
    getCalendar: async () => ({
      provider: { organisationId: 'p1', organisationAbbreviation: 'ITA', settings: { apiKey: 'secret' } },
      tournaments,
    }),
    setCalendar: async () => ({ success: true }),
    listCalendars: async () => [],
  };
  return new ProvidersService(null as any, calendarStorage as any, null as any, null as any, null as any);
}

describe('public vs authenticated provider calendar', () => {
  const service = () => serviceWithCalendar([PUBLISHED, UNPUBLISHED]);

  it('PUBLIC route lists only published tournaments', async () => {
    const result: any = await service().getCalendar({ providerAbbr: 'ITA' });
    expect(result.calendar.tournaments.map((t: any) => t.tournamentId)).toEqual(['pub-1']);
  });

  it('PUBLIC route strips private fields from what it does list', async () => {
    const result: any = await service().getCalendar({ providerAbbr: 'ITA' });
    expect(result.calendar.tournaments[0].tournament).not.toHaveProperty('notes');
    expect(result.calendar.provider).not.toHaveProperty('settings');
  });

  it('AUTHENTICATED route lists unpublished tournaments — the entitlement this split exists for', async () => {
    const result: any = await service().getProviderCalendar({ providerAbbr: 'ITA' });
    expect(result.calendar.tournaments.map((t: any) => t.tournamentId)).toEqual(['pub-1', 'draft-1']);
  });

  it('AUTHENTICATED route returns the full entry, unprojected', async () => {
    const result: any = await service().getProviderCalendar({ providerAbbr: 'ITA' });
    expect(result.calendar.tournaments[1].tournament.notes).toBe('internal');
    expect(result.calendar.provider.settings).toEqual({ apiKey: 'secret' });
  });

  it('projecting for the public route does not mutate the stored entry', async () => {
    const svc = service();
    await svc.getCalendar({ providerAbbr: 'ITA' });
    const after: any = await svc.getProviderCalendar({ providerAbbr: 'ITA' });
    expect(after.calendar.tournaments).toHaveLength(2);
    expect(after.calendar.tournaments[0].published).toBe(true);
  });

  it('AUTHENTICATED route requires a providerAbbr', async () => {
    const result: any = await service().getProviderCalendar({ providerAbbr: undefined });
    expect(result.error).toBeDefined();
  });

  // The Button corpus is 98% unpublished. A published-only filter passes trivially
  // against an all-published fixture; this is the negative case that makes it mean
  // something.
  it('public route returns an empty list when nothing is published', async () => {
    const svc = serviceWithCalendar([UNPUBLISHED, { ...UNPUBLISHED, tournamentId: 'draft-2' }]);
    const result: any = await svc.getCalendar({ providerAbbr: 'ITA' });
    expect(result.calendar.tournaments).toEqual([]);

    const authed: any = await svc.getProviderCalendar({ providerAbbr: 'ITA' });
    expect(authed.calendar.tournaments).toHaveLength(2);
  });
});
