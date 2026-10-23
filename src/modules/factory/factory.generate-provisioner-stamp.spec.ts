import { Logger } from '@nestjs/common';

import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { FactoryService } from './factory.service';

// /factory/generate stamps a tournament_provisioner row for a provisioner request. The response must not
// reach the caller before that row exists: a caller that creates and then asks who owns the tournament
// read `null` (CI run 39827864713, provisioner-mismatched-providerid.e2e.spec.ts D3).

const PROVISIONER = { provisionerId: 'prov-1', providerId: 'managed', provisionerName: 'Prov' };
const USER = { roles: ['client', 'generate'] };
const USER_CONTEXT: any = {
  userId: 'u1',
  email: 'u1@x.org',
  isSuperAdmin: false,
  globalRoles: ['client', 'generate'],
  providerIds: ['managed'],
  providerRoles: { managed: 'PROVIDER_ADMIN' },
  actingProviderId: 'managed',
};

function makeFactoryService(create: (row: any) => Promise<any>) {
  const tournamentStorageService: any = { saveTournamentRecords: vi.fn().mockResolvedValue({ success: true }) };
  const snapshotProjection: any = new SnapshotProjectionService({ isEnabled: false, enqueue: vi.fn() } as any);
  const mutationServices: any = new MutationServicesService(
    { isEnabled: false, enqueue: vi.fn() } as any,
    {
      record: vi.fn(),
      isEnabled: false,
    } as any,
  );
  const tournamentProvisionerStorage: any = { create: vi.fn(create) };

  const svc = new FactoryService(
    tournamentStorageService,
    snapshotProjection,
    mutationServices,
    {} as any,
    {} as any,
    {} as any,
    tournamentProvisionerStorage,
    {} as any,
  );
  return { svc, tournamentProvisionerStorage };
}

describe('FactoryService.generateTournamentRecord provisioner stamp', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not resolve until the ownership row is written', async () => {
    let release: () => void = () => undefined;
    const written: string[] = [];
    const { svc, tournamentProvisionerStorage } = makeFactoryService(
      (row) =>
        new Promise<void>((resolve) => {
          release = () => {
            written.push(row.tournamentId);
            resolve();
          };
        }),
    );

    let settled = false;
    const pending = svc.generateTournamentRecord({}, USER, USER_CONTEXT, PROVISIONER).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(tournamentProvisionerStorage.create).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    release();
    const result: any = await pending;
    expect(result.success).toBe(true);
    expect(written).toEqual([result.tournamentRecord.tournamentId]);
    expect(tournamentProvisionerStorage.create).toHaveBeenCalledWith({
      tournamentId: result.tournamentRecord.tournamentId,
      provisionerId: 'prov-1',
      providerId: 'managed',
    });
  });

  it('a failed stamp is logged and the tournament is still created', async () => {
    const logged = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const { svc } = makeFactoryService(() => Promise.reject(new Error('row write refused')));

    const result: any = await svc.generateTournamentRecord({}, USER, USER_CONTEXT, PROVISIONER);
    expect(result.success).toBe(true);
    expect(logged).toHaveBeenCalledWith(
      `Provisioner stamp failed for ${result.tournamentRecord.tournamentId}: row write refused`,
      'FactoryService',
    );
  });
});
