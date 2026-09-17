import { TournamentStorageService } from './tournament-storage.service';
import { CALENDAR_LISTED } from 'src/helpers/calendarListing';
import { canDeleteTournament } from 'src/modules/factory/helpers/checkTournamentAccess';
import { InMemoryCalendarStorage } from 'src/tests/helpers/inMemoryCalendarStorage';
import { PROVIDER_ADMIN, DIRECTOR } from 'src/common/constants/roles';

// getCalendarEntry is pure (a thin wrapper over the factory's pure calendar-entry
// deriver + a createdByUserId read) — no infra — so these facade tests use the
// real function, exercising the real entry shape rather than a stub that could
// drift from it.

const BOBOCA = 'prov-boboca';
const ION = 'prov-ion';
const TID = 'tourn-1';

const abbrFor = (providerId: string) => (providerId === BOBOCA ? 'BOBOCA' : 'ION');

function buildRecord(over: any = {}) {
  const providerId = over.providerId ?? BOBOCA;
  return {
    tournamentId: over.tournamentId ?? TID,
    tournamentName: over.tournamentName ?? 'Battle of Boca',
    endDate: 'endDate' in over ? over.endDate : '2020-01-01',
    isMock: over.isMock ?? false,
    parentOrganisation: { organisationId: providerId, organisationAbbreviation: abbrFor(providerId) },
    extensions: over.createdBy ? [{ name: 'createdByUserId', value: over.createdBy }] : [],
  };
}

function ctx(over: any = {}) {
  return { userId: 'u-1', isSuperAdmin: false, providerRoles: {}, provisionerProviderIds: [], providerIds: [], ...over };
}

describe('TournamentStorageService — delete safeguards', () => {
  let service: TournamentStorageService;
  let tournamentStorage: any;
  let providerStorage: any;
  let calendarStorage: any;
  let participationStorage: any;

  beforeEach(() => {
    tournamentStorage = {
      findTournamentRecord: vi.fn(),
      archiveTournamentRecord: vi.fn().mockResolvedValue({ success: true }),
      removeTournamentRecords: vi.fn().mockResolvedValue({ success: true, removed: 1 }),
      saveTournamentRecord: vi.fn().mockResolvedValue({ success: true }),
    };
    providerStorage = {
      getProvider: vi.fn().mockResolvedValue({ organisationId: BOBOCA, organisationAbbreviation: 'BOBOCA' }),
    };
    calendarStorage = new InMemoryCalendarStorage([{ tournamentId: TID, providerId: BOBOCA, searchText: '' }]);
    vi.spyOn(calendarStorage, 'upsertTournament');
    vi.spyOn(calendarStorage, 'removeTournament');
    vi.spyOn(calendarStorage, 'getTournament');
    participationStorage = {
      replaceTournamentRows: vi.fn().mockResolvedValue({ success: true }),
      listForSubject: vi.fn().mockResolvedValue([]),
      deleteTournamentRows: vi.fn().mockResolvedValue({ success: true }),
    };
    service = new TournamentStorageService(
      tournamentStorage,
      providerStorage,
      calendarStorage,
      { isEnabled: false, enqueue: vi.fn() } as any,
      participationStorage,
    );
  });

  const adminAt = (providerId: string) => ctx({ userId: 'clubx', providerRoles: { [providerId]: PROVIDER_ADMIN } });

  it('denies a cross-provider delete even with the global deleteTournament permission', async () => {
    tournamentStorage.findTournamentRecord.mockResolvedValue({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    const result: any = await service.removeTournamentRecords(
      { tournamentId: TID },
      { userId: 'smadler', email: 's@x.com', roles: ['admin'], permissions: ['deleteTournament'] },
      undefined,
      ctx({ userId: 'smadler', providerRoles: { [ION]: PROVIDER_ADMIN } }),
    );
    expect(result.errorCode).toBe('ERR_DELETE_FORBIDDEN');
    expect(result.removed).toBe(0);
    expect(tournamentStorage.archiveTournamentRecord).not.toHaveBeenCalled();
    expect(tournamentStorage.removeTournamentRecords).not.toHaveBeenCalled();
  });

  it('allows a PROVIDER_ADMIN at the tournament’s own provider (ended tournament)', async () => {
    tournamentStorage.findTournamentRecord.mockResolvedValue({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    const result: any = await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'clubx' }, undefined, adminAt(BOBOCA));
    expect(result.removed).toBe(1);
    expect(tournamentStorage.archiveTournamentRecord).toHaveBeenCalledTimes(1);
    expect(tournamentStorage.removeTournamentRecords).toHaveBeenCalledWith({ tournamentIds: [TID] });
  });

  it('allows a SUPER_ADMIN to delete across providers', async () => {
    tournamentStorage.findTournamentRecord.mockResolvedValue({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    const result: any = await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'root' }, undefined, ctx({ isSuperAdmin: true }));
    expect(result.removed).toBe(1);
  });

  it('archives BEFORE deleting the row', async () => {
    const order: string[] = [];
    tournamentStorage.findTournamentRecord.mockResolvedValue({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    tournamentStorage.archiveTournamentRecord.mockImplementation(async () => {
      order.push('archive');
      return { success: true };
    });
    tournamentStorage.removeTournamentRecords.mockImplementation(async () => {
      order.push('delete');
      return { removed: 1 };
    });
    await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'clubx' }, undefined, adminAt(BOBOCA));
    expect(order).toEqual(['archive', 'delete']);
  });

  it('aborts the delete when archiving fails', async () => {
    tournamentStorage.findTournamentRecord.mockResolvedValue({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    tournamentStorage.archiveTournamentRecord.mockResolvedValue({ error: 'DB down' });
    const result: any = await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'clubx' }, undefined, adminAt(BOBOCA));
    expect(result.errorCode).toBe('ERR_ARCHIVE_FAILED');
    expect(tournamentStorage.removeTournamentRecords).not.toHaveBeenCalled();
  });

  it('blocks deleting a non-mock tournament whose end date is in the future', async () => {
    tournamentStorage.findTournamentRecord.mockResolvedValue({
      tournamentRecord: buildRecord({ providerId: BOBOCA, endDate: '2999-01-01' }),
    });
    const result: any = await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'clubx' }, undefined, adminAt(BOBOCA));
    expect(result.errorCode).toBe('ERR_TOURNAMENT_NOT_ENDED');
    expect(tournamentStorage.archiveTournamentRecord).not.toHaveBeenCalled();
    expect(tournamentStorage.removeTournamentRecords).not.toHaveBeenCalled();
  });

  it('allows deleting a mock tournament regardless of end date', async () => {
    tournamentStorage.findTournamentRecord.mockResolvedValue({
      tournamentRecord: buildRecord({ providerId: BOBOCA, endDate: '2999-01-01', isMock: true }),
    });
    const result: any = await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'clubx' }, undefined, adminAt(BOBOCA));
    expect(result.removed).toBe(1);
  });

  it('removes the calendar entry from the tournament’s OWN provider, leaving siblings', async () => {
    tournamentStorage.findTournamentRecord.mockResolvedValue({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    calendarStorage.entries.set('other', { tournamentId: 'other', providerId: BOBOCA, searchText: '' });

    await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'clubx' }, undefined, adminAt(BOBOCA));

    // One row deleted by primary key, rather than the provider's whole array rewritten.
    expect(calendarStorage.removeTournament).toHaveBeenCalledWith(TID);
    expect([...calendarStorage.entries.keys()]).toEqual(['other']);
  });
});

describe('TournamentStorageService — provider move (save side-effect)', () => {
  let service: TournamentStorageService;
  let tournamentStorage: any;
  let providerStorage: any;
  let calendarStorage: any;
  let participationStorage: any;

  beforeEach(() => {
    tournamentStorage = { saveTournamentRecord: vi.fn().mockResolvedValue({ success: true }) };
    providerStorage = {
      getProvider: vi.fn().mockResolvedValue({ organisationId: BOBOCA, organisationAbbreviation: 'BOBOCA' }),
    };
    calendarStorage = new InMemoryCalendarStorage();
    vi.spyOn(calendarStorage, 'upsertTournament');
    vi.spyOn(calendarStorage, 'removeTournament');
    vi.spyOn(calendarStorage, 'getTournament');
    participationStorage = {
      replaceTournamentRows: vi.fn().mockResolvedValue({ success: true }),
      listForSubject: vi.fn().mockResolvedValue([]),
      deleteTournamentRows: vi.fn().mockResolvedValue({ success: true }),
    };
    service = new TournamentStorageService(
      tournamentStorage,
      providerStorage,
      calendarStorage,
      { isEnabled: false, enqueue: vi.fn() } as any,
      participationStorage,
    );
  });

  it('moves the tournament to its new provider, leaving the old provider’s siblings', async () => {
    // Pre-047 this needed `detachFromOtherCalendars` — a `listCalendars()` sweep reading
    // EVERY provider's calendar into memory on each move. `tournament_id` is the primary
    // key now, so the upsert relocates the row and the sweep is deleted: the invariant is
    // the schema rather than a procedure that has to remember to run.
    calendarStorage.entries.set(TID, { tournamentId: TID, providerId: 'ION', searchText: '' });
    calendarStorage.entries.set('keep', { tournamentId: 'keep', providerId: 'ION', searchText: '' });

    await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });

    expect(calendarStorage.entries.get(TID).providerId).toBe(BOBOCA);
    expect(calendarStorage.entries.get('keep').providerId).toBe('ION');
    // Exactly one row: the tournament cannot be in two calendars, by construction.
    expect([...calendarStorage.entries.values()].filter((e: any) => e.tournamentId === TID)).toHaveLength(1);
  });

  it('an UNLISTED record touches the calendar not at all', async () => {
    // The seam still matters, for a different reason than it did. It is no longer that a
    // save rewrites the provider's whole array — 047 made that a single-row upsert — but
    // that an unlisted fixture has no business in a calendar at all.
    const record: any = buildRecord({ providerId: BOBOCA });
    record.extensions.push({ name: CALENDAR_LISTED, value: false });

    await service.saveTournamentRecord({ tournamentRecord: record });

    expect(calendarStorage.upsertTournament).not.toHaveBeenCalled();
    // Still stored, and still indexed: unlisted means "not in the calendar", not "not saved".
    expect(tournamentStorage.saveTournamentRecord).toHaveBeenCalled();
    expect(participationStorage.replaceTournamentRows).toHaveBeenCalled();
  });

  it('still lists a record that says nothing about listing', async () => {
    await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    expect(calendarStorage.upsertTournament).toHaveBeenCalled();
  });

  it('derives real participation rows THROUGH the factory, both sides of a fixture', async () => {
    // Without this the suite cannot tell a working derivation from one that returns nothing: every
    // other record here has no issued identities, so `[]` is the correct answer either way and a
    // neutered call still passes. Proven by falsification — stubbing the derivation out left all
    // other tests green.
    const record: any = buildRecord({ providerId: BOBOCA });
    const issued = (participantId: string, issuedId: string) => ({
      participantId,
      participantType: 'TEAM',
      participantName: `Team ${issuedId}`,
      participantOtherIds: [{ organisationId: 'org-1', participantId: issuedId }],
    });
    record.participants = [issued('local-a', 'ITA-A'), issued('local-b', 'ITA-B')];
    record.events = [{ eventId: 'dual' }];

    await service.saveTournamentRecord({ tournamentRecord: record });

    const [tournamentId, rows] = participationStorage.replaceTournamentRows.mock.calls.at(-1);
    expect(tournamentId).toBe(TID);
    expect(rows.map((row: any) => row.subjectId).sort((a: string, b: string) => a.localeCompare(b, 'en'))).toEqual([
      'ITA-A',
      'ITA-B',
    ]);
    // Keyed on the ISSUED id, with the tournament-local id kept separately.
    expect(rows.every((row: any) => row.subjectType === 'TEAM')).toBe(true);
    expect(rows.map((row: any) => row.participantId).sort((a: string, b: string) => a.localeCompare(b, 'en'))).toEqual([
      'local-a',
      'local-b',
    ]);
    // INVERTED when 046 added the column. It previously asserted the mapping must NOT carry an
    // issuer, because the table had nowhere to put one; now it must, because a subjectId is unique
    // only within the body that issued it and a read without the issuer merges two competitors.
    expect(rows.every((row: any) => row.organisationId === 'org-1')).toBe(true);
  });

  it('rewrites participation on every save, so a removed competitor loses its row', async () => {
    await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    expect(participationStorage.replaceTournamentRows).toHaveBeenCalledWith(TID, []);
  });

  it('saves the tournament even when the participation index fails', async () => {
    // A derived read model must not be able to turn its own outage into a write outage.
    participationStorage.replaceTournamentRows.mockRejectedValue(new Error('index down'));
    const result = await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    expect(result).toEqual({ success: true });
  });

  it('never reads another calendar on save — not for a new tournament, not for an update', async () => {
    // This used to assert a NARROWER thing: that the `listCalendars()` detach sweep was
    // skipped when the tournament was already listed in its provider. A first-time save
    // still paid for it. Post-047 there is no sweep to skip — `tournament_id` is the
    // primary key — so the claim is now unconditional, and worth stating that way.
    const listSpy = vi.spyOn(calendarStorage, 'listProviderTournaments');

    // First save (the case that used to trigger the sweep)...
    await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    // ...and an update of the same tournament.
    await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });

    expect(listSpy).not.toHaveBeenCalled();
    // Two saves, two single-row upserts — the write cost does not grow with the calendar.
    expect(calendarStorage.upsertTournament).toHaveBeenCalledTimes(2);
  });
});

describe('canDeleteTournament — provider-scoped, flag-independent', () => {
  const rec = (providerId: string, createdBy?: string) => ({
    tournamentId: TID,
    parentOrganisation: { organisationId: providerId },
    extensions: createdBy ? [{ name: 'createdByUserId', value: createdBy }] : [],
  });

  it('denies when there is no userContext', () => expect(canDeleteTournament(rec(BOBOCA), undefined)).toBe(false));
  it('allows SUPER_ADMIN anywhere', () => expect(canDeleteTournament(rec(BOBOCA), ctx({ isSuperAdmin: true }))).toBe(true));
  it('allows a provisioner-owner of the provider', () =>
    expect(canDeleteTournament(rec(BOBOCA), ctx({ provisionerProviderIds: [BOBOCA] }))).toBe(true));
  it('allows PROVIDER_ADMIN at the provider', () =>
    expect(canDeleteTournament(rec(BOBOCA), ctx({ providerRoles: { [BOBOCA]: PROVIDER_ADMIN } }))).toBe(true));
  it('denies PROVIDER_ADMIN at a DIFFERENT provider', () =>
    expect(canDeleteTournament(rec(BOBOCA), ctx({ providerRoles: { [ION]: PROVIDER_ADMIN } }))).toBe(false));
  it('allows a DIRECTOR who created the tournament', () =>
    expect(canDeleteTournament(rec(BOBOCA, 'u-1'), ctx({ providerRoles: { [BOBOCA]: DIRECTOR } }))).toBe(true));
  it('denies a DIRECTOR who did not create it', () =>
    expect(canDeleteTournament(rec(BOBOCA, 'someone-else'), ctx({ providerRoles: { [BOBOCA]: DIRECTOR } }))).toBe(false));
  it('denies when the tournament has no owning provider', () =>
    expect(canDeleteTournament({ tournamentId: TID, parentOrganisation: {} }, ctx())).toBe(false));
});
