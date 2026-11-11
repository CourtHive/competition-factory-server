import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { sanctioningEngine } from 'tods-competition-factory';

import { SanctioningActivationService } from './sanctioning-activation.service';

// The provider administrator's activate from the AMS console. Each rule is asserted in both directions; the factory's
// activateFromSanctioning is spied so the record built is the one the test chose.

const PROVIDER = 'prov-1';
const approvedRecord = {
  sanctioningId: 'sanc-1',
  status: 'APPROVED',
  governingBodyId: PROVIDER,
  proposal: { tournamentName: 'Sanctioned Open', events: [] },
};
const builtTournament = { tournamentId: 't-new', parentOrganisation: { organisationId: PROVIDER } };

const user = (overrides: any = {}): any => ({
  userId: 'u-1',
  email: 'u@test.com',
  isSuperAdmin: false,
  globalRoles: [],
  providerRoles: {},
  providerIds: [],
  provisionerProviderIds: [],
  ...overrides,
});
const providerAdmin = user({ providerRoles: { [PROVIDER]: 'PROVIDER_ADMIN' }, providerIds: [PROVIDER] });
const director = user({ providerRoles: { [PROVIDER]: 'DIRECTOR' }, providerIds: [PROVIDER] });
const otherAdmin = user({ providerRoles: { 'prov-9': 'PROVIDER_ADMIN' }, providerIds: ['prov-9'] });

describe('SanctioningActivationService', () => {
  let tournamentStorageService: any;
  let sanctioningClient: any;
  let service: SanctioningActivationService;
  let activateSpy: any;

  beforeEach(() => {
    tournamentStorageService = {
      findTournamentRecord: vi.fn().mockResolvedValue({ tournamentRecord: null }),
      saveTournamentRecord: vi.fn().mockResolvedValue({ success: true }),
    };
    sanctioningClient = {
      getRecordById: vi.fn().mockResolvedValue(approvedRecord),
      markActivated: vi.fn().mockResolvedValue(undefined),
    };
    service = new SanctioningActivationService(tournamentStorageService, sanctioningClient);
    activateSpy = vi
      .spyOn(sanctioningEngine as any, 'activateFromSanctioning')
      .mockReturnValue({ success: true, tournamentRecord: structuredClone(builtTournament) });
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates and stores the tournament for the provider's administrator, then tells AMS", async () => {
    const result = await service.activate('sanc-1', providerAdmin);

    expect(result).toEqual({ success: true, tournamentId: 't-new', created: true });
    expect(tournamentStorageService.saveTournamentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentRecord: expect.objectContaining({ tournamentId: 't-new' }), userId: 'u-1' }),
    );
    expect(sanctioningClient.markActivated).toHaveBeenCalledWith('sanc-1', 't-new');
  });

  it("refuses the provider's director and another provider's administrator: activation is the reviewer's", async () => {
    for (const caller of [director, otherAdmin]) {
      await expect(service.activate('sanc-1', caller)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(activateSpy).not.toHaveBeenCalled();
    expect(tournamentStorageService.saveTournamentRecord).not.toHaveBeenCalled();
  });

  it('admits a super-admin', async () => {
    await expect(service.activate('sanc-1', user({ isSuperAdmin: true }))).resolves.toMatchObject({ created: true });
  });

  it('answers 404 for a record AMS does not have', async () => {
    sanctioningClient.getRecordById.mockResolvedValue(null);
    await expect(service.activate('nope', providerAdmin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a record that is not APPROVED, and stores nothing', async () => {
    sanctioningClient.getRecordById.mockResolvedValue({ ...approvedRecord, status: 'UNDER_REVIEW' });
    await expect(service.activate('sanc-1', providerAdmin)).rejects.toBeInstanceOf(ConflictException);
    expect(tournamentStorageService.saveTournamentRecord).not.toHaveBeenCalled();
  });

  it('for a tournament that already exists, stores nothing and tells AMS again', async () => {
    sanctioningClient.getRecordById.mockResolvedValue({
      ...approvedRecord,
      status: 'ACTIVE',
      proposal: { ...approvedRecord.proposal, tournamentId: 't-1' },
    });
    tournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: { tournamentId: 't-1' } });

    const result = await service.activate('sanc-1', providerAdmin);

    expect(result).toEqual({ success: true, tournamentId: 't-1', created: false });
    expect(activateSpy).not.toHaveBeenCalled();
    expect(tournamentStorageService.saveTournamentRecord).not.toHaveBeenCalled();
    expect(sanctioningClient.markActivated).toHaveBeenCalledWith('sanc-1', 't-1');
  });

  it('keeps the stored tournament when AMS cannot be told', async () => {
    sanctioningClient.markActivated.mockRejectedValue(new Error('AMS unreachable'));
    const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(service.activate('sanc-1', providerAdmin)).resolves.toMatchObject({ created: true });

    expect(tournamentStorageService.saveTournamentRecord).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('AMS not told'));
  });
});
