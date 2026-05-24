import { TournamentStorageService } from './tournament-storage.service';
import { canDeleteTournament } from 'src/modules/factory/helpers/checkTournamentAccess';
import { PROVIDER_ADMIN, DIRECTOR } from 'src/common/constants/roles';

// getCalendarEntry calls the factory's getTournamentInfo; stub it so these unit
// tests exercise the facade's calendar logic, not the factory.
jest.mock('src/helpers/getCalendarEntry', () => ({
  getCalendarEntry: ({ tournamentRecord }: any) => ({
    tournamentId: tournamentRecord.tournamentId,
    providerId: tournamentRecord.parentOrganisation?.organisationId,
    searchText: (tournamentRecord.tournamentName || '').toLowerCase(),
    tournament: { tournamentName: tournamentRecord.tournamentName },
  }),
}));

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

  beforeEach(() => {
    tournamentStorage = {
      findTournamentRecord: jest.fn(),
      archiveTournamentRecord: jest.fn().mockResolvedValue({ success: true }),
      removeTournamentRecords: jest.fn().mockResolvedValue({ success: true, removed: 1 }),
      saveTournamentRecord: jest.fn().mockResolvedValue({ success: true }),
    };
    providerStorage = { getProvider: jest.fn().mockResolvedValue({ organisationAbbreviation: 'BOBOCA' }) };
    calendarStorage = {
      getCalendar: jest
        .fn()
        .mockResolvedValue({ provider: { organisationAbbreviation: 'BOBOCA' }, tournaments: [{ tournamentId: TID }] }),
      setCalendar: jest.fn().mockResolvedValue({ success: true }),
      listCalendars: jest.fn().mockResolvedValue([]),
    };
    service = new TournamentStorageService(tournamentStorage, providerStorage, calendarStorage);
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
    calendarStorage.getCalendar.mockResolvedValue({
      provider: { organisationAbbreviation: 'BOBOCA' },
      tournaments: [{ tournamentId: TID }, { tournamentId: 'other' }],
    });
    await service.removeTournamentRecords({ tournamentId: TID }, { userId: 'clubx' }, undefined, adminAt(BOBOCA));
    expect(providerStorage.getProvider).toHaveBeenCalledWith(BOBOCA);
    expect(calendarStorage.setCalendar).toHaveBeenCalledWith(
      'BOBOCA',
      expect.objectContaining({ tournaments: [{ tournamentId: 'other' }] }),
    );
  });
});

describe('TournamentStorageService — detach-on-move (save side-effect)', () => {
  let service: TournamentStorageService;
  let tournamentStorage: any;
  let providerStorage: any;
  let calendarStorage: any;

  beforeEach(() => {
    tournamentStorage = { saveTournamentRecord: jest.fn().mockResolvedValue({ success: true }) };
    providerStorage = { getProvider: jest.fn().mockResolvedValue({ organisationAbbreviation: 'BOBOCA' }) };
    calendarStorage = {
      getCalendar: jest.fn().mockResolvedValue({ provider: { organisationAbbreviation: 'BOBOCA' }, tournaments: [] }),
      setCalendar: jest.fn().mockResolvedValue({ success: true }),
      listCalendars: jest.fn().mockResolvedValue([]),
    };
    service = new TournamentStorageService(tournamentStorage, providerStorage, calendarStorage);
  });

  it('detaches the tournament from another provider’s calendar when first added to its new provider', async () => {
    calendarStorage.listCalendars.mockResolvedValue([
      { key: 'ION', value: { provider: { organisationAbbreviation: 'ION' }, tournaments: [{ tournamentId: TID }, { tournamentId: 'keep' }] } },
      { key: 'BOBOCA', value: { provider: { organisationAbbreviation: 'BOBOCA' }, tournaments: [] } },
    ]);
    await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    expect(calendarStorage.setCalendar).toHaveBeenCalledWith(
      'ION',
      expect.objectContaining({ tournaments: [{ tournamentId: 'keep' }] }),
    );
  });

  it('does NOT scan other calendars on a normal update (tournament already listed in its provider)', async () => {
    calendarStorage.getCalendar.mockResolvedValue({
      provider: { organisationAbbreviation: 'BOBOCA' },
      tournaments: [{ tournamentId: TID, tournament: {} }],
    });
    await service.saveTournamentRecord({ tournamentRecord: buildRecord({ providerId: BOBOCA }) });
    expect(calendarStorage.listCalendars).not.toHaveBeenCalled();
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
