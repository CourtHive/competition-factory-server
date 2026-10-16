import { factoryConstants } from 'tods-competition-factory';

import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { CREATED_BY_USER_ID } from './helpers/checkTournamentAccess';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import { FactoryService } from './factory.service';

import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

const MISSING_TOURNAMENT_RECORD = factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD;

const PROVIDER = 'provider-1';
const DIRECTOR_ID = 'director-1';
const OTHER_ID = 'director-2';
const ADMIN_ID = 'admin-1';
const TOURNAMENT_ID = 't-1';

function director(userId = DIRECTOR_ID): UserContext {
  return {
    userId,
    email: `${userId}@test.com`,
    isSuperAdmin: false,
    globalRoles: ['client'],
    providerRoles: { [PROVIDER]: 'DIRECTOR' },
    providerIds: [PROVIDER],
  } as UserContext;
}

function providerAdmin(): UserContext {
  return { ...director(ADMIN_ID), providerRoles: { [PROVIDER]: PROVIDER_ADMIN } };
}

function record(createdByUserId?: string) {
  return {
    tournamentId: TOURNAMENT_ID,
    tournamentName: 'Director Create',
    startDate: '2026-10-15',
    endDate: '2026-10-19',
    parentOrganisation: { organisationId: PROVIDER },
    extensions: createdByUserId ? [{ name: CREATED_BY_USER_ID, value: createdByUserId }] : [],
  };
}

function createdBy(tournamentRecord: any) {
  return tournamentRecord.extensions.filter((e: any) => e.name === CREATED_BY_USER_ID).map((e: any) => e.value);
}

/** `stored` is what storage holds for TOURNAMENT_ID; undefined means the tournament does not exist yet. */
function makeFactoryService({
  stored,
  assignedRoles = new Map(),
}: {
  stored?: { createdByUserId?: string };
  assignedRoles?: Map<string, string>;
}) {
  const tournamentStorageService: any = {
    saveTournamentRecords: vi.fn().mockResolvedValue({ success: true }),
    fetchTournamentUpdatedAt: vi.fn().mockResolvedValue(
      stored
        ? {
            success: true,
            tournamentId: TOURNAMENT_ID,
            providerId: PROVIDER,
            extensions: stored.createdByUserId ? [{ name: CREATED_BY_USER_ID, value: stored.createdByUserId }] : [],
          }
        : { error: MISSING_TOURNAMENT_RECORD },
    ),
  };
  const assignmentsService: any = {
    getAssignedTournamentIds: vi.fn().mockResolvedValue(new Set(assignedRoles.keys())),
    getAssignedRoles: vi.fn().mockResolvedValue(assignedRoles),
  };
  const snapshotProjection: any = new SnapshotProjectionService({ isEnabled: false, enqueue: vi.fn() } as any);
  const mutationServices: any = new MutationServicesService(
    { isEnabled: false, enqueue: vi.fn() } as any,
    {
      record: vi.fn(),
      isEnabled: false,
    } as any,
  );
  const providerStorage: any = { getProvider: vi.fn().mockResolvedValue(undefined) };

  const svc = new FactoryService(
    tournamentStorageService,
    snapshotProjection,
    mutationServices,
    assignmentsService,
    {} as any,
    {} as any,
    {} as any,
    providerStorage,
    {} as any,
  );
  return { svc, tournamentStorageService };
}

function save(svc: FactoryService, tournamentRecord: any, userContext: UserContext) {
  return svc.saveTournamentRecords({ tournamentRecord }, { userId: userContext.userId }, userContext);
}

describe('FactoryService.saveTournamentRecords — who may create and overwrite a tournament', () => {
  const previous = process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
  beforeAll(() => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
    else process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = previous;
  });

  describe('creation (the tournament does not exist yet)', () => {
    it('a DIRECTOR of the provider may create a tournament', async () => {
      const { svc, tournamentStorageService } = makeFactoryService({});
      const result: any = await save(svc, record(), director());

      expect(result.success).toBe(true);
      expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
    });

    it('the creator is the caller', async () => {
      const { svc } = makeFactoryService({});
      const tournamentRecord = record();
      await save(svc, tournamentRecord, director());

      expect(createdBy(tournamentRecord)).toEqual([DIRECTOR_ID]);
    });

    it('a creator named by the client is replaced by the caller', async () => {
      const { svc } = makeFactoryService({});
      const tournamentRecord = record(OTHER_ID);
      await save(svc, tournamentRecord, director());

      expect(createdBy(tournamentRecord)).toEqual([DIRECTOR_ID]);
    });

    it('a user with no role at the provider may not create there', async () => {
      const { svc, tournamentStorageService } = makeFactoryService({});
      const outsider = { ...director(), providerRoles: { 'provider-2': 'DIRECTOR' }, providerIds: ['provider-2'] };
      const result: any = await save(svc, record(), outsider);

      expect(result.error).toBeDefined();
      expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
    });
  });

  describe('overwrite (the tournament exists)', () => {
    it('a DIRECTOR may save a tournament they created', async () => {
      const { svc } = makeFactoryService({ stored: { createdByUserId: DIRECTOR_ID } });
      const result: any = await save(svc, record(DIRECTOR_ID), director());

      expect(result.success).toBe(true);
    });

    it("a DIRECTOR may not overwrite another director's tournament by naming themselves its creator", async () => {
      const { svc, tournamentStorageService } = makeFactoryService({ stored: { createdByUserId: OTHER_ID } });
      const result: any = await save(svc, record(DIRECTOR_ID), director());

      expect(result.error).toBe(`User not allowed to modify tournament ${TOURNAMENT_ID}`);
      expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
    });

    it('an assigned DIRECTOR may save, and the stored creator is kept', async () => {
      const { svc } = makeFactoryService({
        stored: { createdByUserId: OTHER_ID },
        assignedRoles: new Map([[TOURNAMENT_ID, 'DIRECTOR']]),
      });
      const tournamentRecord = record(DIRECTOR_ID);
      const result: any = await save(svc, tournamentRecord, director());

      expect(result.success).toBe(true);
      expect(createdBy(tournamentRecord)).toEqual([OTHER_ID]);
    });

    it('a PROVIDER_ADMIN may save any tournament of the provider, and the stored creator is kept', async () => {
      const { svc } = makeFactoryService({ stored: { createdByUserId: OTHER_ID } });
      const tournamentRecord = record();
      const result: any = await save(svc, tournamentRecord, providerAdmin());

      expect(result.success).toBe(true);
      expect(createdBy(tournamentRecord)).toEqual([OTHER_ID]);
    });

    it('a save is refused when existence cannot be established', async () => {
      const { svc, tournamentStorageService } = makeFactoryService({});
      tournamentStorageService.fetchTournamentUpdatedAt.mockResolvedValue({ error: 'connection refused' });
      const result: any = await save(svc, record(), providerAdmin());

      expect(result.error).toBe(`User not allowed to modify tournament ${TOURNAMENT_ID}`);
      expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
    });
  });
});

describe('FactoryService.fetchTournamentUpdatedAt — assigned directors', () => {
  const previous = process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
  beforeAll(() => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
    else process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = previous;
  });

  it('a DIRECTOR assigned to a tournament they did not create may probe it', async () => {
    const { svc } = makeFactoryService({
      stored: { createdByUserId: OTHER_ID },
      assignedRoles: new Map([[TOURNAMENT_ID, 'DIRECTOR']]),
    });
    const userContext = director();
    const result: any = await svc.fetchTournamentUpdatedAt(
      { tournamentId: TOURNAMENT_ID },
      { userId: userContext.userId },
      userContext,
    );

    expect(result.success).toBe(true);
  });
});
