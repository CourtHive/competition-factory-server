import { factoryConstants } from 'tods-competition-factory';
import { Logger } from '@nestjs/common';

import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import { FactoryService } from './factory.service';

import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

// /factory/save is a provisioner's create path (IONSport creates every tournament through it), and it wrote no
// tournament_provisioner row: from 2026-05 the only rows its tournaments had were the ones backfills wrote
// (Mentat/scripts/data-fixes/2026-09-25-ionsport-provisioner-stamp-gap.sql). A save that CREATES a tournament
// for a provisioner request must stamp it, as /factory/generate does
// (factory.generate-provisioner-stamp.spec.ts).

const MISSING_TOURNAMENT_RECORD = factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD;

const PROVIDER = 'managed';
const TOURNAMENT_ID = 't-1';
const PROVISIONER = { provisionerId: 'prov-1' };

// what provisioner.middleware injects for a prov_ key with X-Provider-Id: managed
const PROVISIONER_CONTEXT: UserContext = {
  userId: `provisioner:${PROVISIONER.provisionerId}`,
  email: 'provisioner@Prov',
  isSuperAdmin: false,
  globalRoles: ['client', 'generate', 'score'],
  providerRoles: { [PROVIDER]: PROVIDER_ADMIN },
  providerIds: [PROVIDER],
} as UserContext;

function record() {
  return {
    tournamentId: TOURNAMENT_ID,
    tournamentName: 'Provisioner Create',
    startDate: '2026-11-14',
    endDate: '2026-11-14',
    parentOrganisation: { organisationId: PROVIDER },
    extensions: [],
  };
}

/** `exists` makes storage hold TOURNAMENT_ID already, so the save is an overwrite. */
function makeFactoryService({
  exists = false,
  create = () => Promise.resolve({ success: true }),
  saved = { success: true },
}: {
  exists?: boolean;
  create?: (row: any) => Promise<any>;
  saved?: any;
} = {}) {
  const tournamentStorageService: any = {
    saveTournamentRecords: vi.fn().mockResolvedValue(saved),
    fetchTournamentUpdatedAt: vi
      .fn()
      .mockResolvedValue(
        exists
          ? { success: true, tournamentId: TOURNAMENT_ID, providerId: PROVIDER, extensions: [] }
          : { error: MISSING_TOURNAMENT_RECORD },
      ),
  };
  const assignmentsService: any = { getAssignedRoles: vi.fn().mockResolvedValue(new Map()) };
  const snapshotProjection: any = new SnapshotProjectionService({ isEnabled: false, enqueue: vi.fn() } as any);
  const mutationServices: any = new MutationServicesService(
    { isEnabled: false, enqueue: vi.fn() } as any,
    { record: vi.fn(), isEnabled: false } as any,
  );
  const tournamentProvisionerStorage: any = { create: vi.fn(create) };
  const providerStorage: any = { getProvider: vi.fn().mockResolvedValue(undefined) };

  const svc = new FactoryService(
    tournamentStorageService,
    snapshotProjection,
    mutationServices,
    assignmentsService,
    {} as any,
    {} as any,
    tournamentProvisionerStorage,
    providerStorage,
  );
  return { svc, tournamentProvisionerStorage, tournamentStorageService };
}

function save(svc: FactoryService, provisionerContext?: { provisionerId: string }, userContext = PROVISIONER_CONTEXT) {
  return svc.saveTournamentRecords(
    { tournamentRecord: record() },
    { userId: userContext.userId },
    userContext,
    provisionerContext,
  );
}

describe('FactoryService.saveTournamentRecords provisioner ownership stamp', () => {
  const previous = process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
  beforeAll(() => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
    else process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = previous;
  });
  afterEach(() => vi.restoreAllMocks());

  it("a provisioner's creating save stamps the ownership row with the record's provider", async () => {
    const { svc, tournamentProvisionerStorage } = makeFactoryService();
    const result: any = await save(svc, PROVISIONER);

    expect(result.success).toBe(true);
    expect(tournamentProvisionerStorage.create).toHaveBeenCalledTimes(1);
    expect(tournamentProvisionerStorage.create).toHaveBeenCalledWith({
      tournamentId: TOURNAMENT_ID,
      provisionerId: PROVISIONER.provisionerId,
      providerId: PROVIDER,
    });
  });

  it('does not resolve until the ownership row is written', async () => {
    let release: () => void = () => undefined;
    const { svc, tournamentProvisionerStorage } = makeFactoryService({
      create: () => new Promise((resolve) => (release = () => resolve({ success: true }))),
    });

    let settled = false;
    const pending = save(svc, PROVISIONER).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(tournamentProvisionerStorage.create).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    release();
    const result: any = await pending;
    expect(result.success).toBe(true);
  });

  it("an overwriting save does not stamp: the tournament's ownership was decided when it was created", async () => {
    const { svc, tournamentProvisionerStorage } = makeFactoryService({ exists: true });
    const result: any = await save(svc, PROVISIONER);

    expect(result.success).toBe(true);
    expect(tournamentProvisionerStorage.create).not.toHaveBeenCalled();
  });

  it('a creating save that is not a provisioner request does not stamp', async () => {
    const { svc, tournamentProvisionerStorage } = makeFactoryService();
    const result: any = await save(svc, undefined);

    expect(result.success).toBe(true);
    expect(tournamentProvisionerStorage.create).not.toHaveBeenCalled();
  });

  it('a save that fails to write does not stamp', async () => {
    const { svc, tournamentProvisionerStorage } = makeFactoryService({ saved: { error: 'write refused' } });
    const result: any = await save(svc, PROVISIONER);

    expect(result.error).toBe('write refused');
    expect(tournamentProvisionerStorage.create).not.toHaveBeenCalled();
  });

  it('a failed stamp is logged and the save still succeeds', async () => {
    const logged = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const { svc } = makeFactoryService({ create: () => Promise.reject(new Error('row write refused')) });

    const result: any = await save(svc, PROVISIONER);
    expect(result.success).toBe(true);
    expect(logged).toHaveBeenCalledWith(
      `Provisioner stamp failed for ${TOURNAMENT_ID}: row write refused`,
      'FactoryService',
    );
  });
});
