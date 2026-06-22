import { FactoryService } from './factory.service';

// Focused unit test for the lightweight staleness probe. Constructs FactoryService
// directly with mocked storage + assignments so no Postgres is needed.

const SUPER_ADMIN_USER = { roles: ['superadmin'] };

function makeService(storageImpl: (params: any) => Promise<any>) {
  const tournamentStorageService = { fetchTournamentUpdatedAt: jest.fn(storageImpl) };
  const assignmentsService = { getAssignedTournamentIds: jest.fn().mockResolvedValue([]) };
  const service = new FactoryService(
    tournamentStorageService as any,
    assignmentsService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, tournamentStorageService, assignmentsService };
}

describe('FactoryService.fetchTournamentUpdatedAt', () => {
  it('returns only { success, tournamentId, updatedAt } for an authorized user', async () => {
    const { service } = makeService(async () => ({
      success: true,
      tournamentId: 't1',
      updatedAt: '2026-06-22T00:00:00.000Z',
      providerId: 'p1',
      extensions: [{ name: 'secret', value: 'x' }],
    }));

    const result: any = await service.fetchTournamentUpdatedAt({ tournamentId: 't1' }, SUPER_ADMIN_USER);

    // Must not leak provider/extensions or any full-record fields to the client.
    expect(Object.keys(result).sort()).toEqual(['success', 'tournamentId', 'updatedAt']);
    expect(result).toEqual({ success: true, tournamentId: 't1', updatedAt: '2026-06-22T00:00:00.000Z' });
  });

  it('rejects an invalid user before touching storage', async () => {
    const { service, tournamentStorageService } = makeService(async () => ({}));
    const result: any = await service.fetchTournamentUpdatedAt({ tournamentId: 't1' }, undefined);
    expect(result.error).toBe('Invalid user');
    expect(tournamentStorageService.fetchTournamentUpdatedAt).not.toHaveBeenCalled();
  });

  it('errors when tournamentId is missing', async () => {
    const { service, tournamentStorageService } = makeService(async () => ({}));
    const result: any = await service.fetchTournamentUpdatedAt({}, SUPER_ADMIN_USER);
    expect(result.error).toBe('Missing tournamentId');
    expect(tournamentStorageService.fetchTournamentUpdatedAt).not.toHaveBeenCalled();
  });

  it('passes through a storage error (e.g. record not found)', async () => {
    const { service } = makeService(async () => ({ error: 'MISSING_TOURNAMENT_RECORD' }));
    const result: any = await service.fetchTournamentUpdatedAt({ tournamentId: 'missing' }, SUPER_ADMIN_USER);
    expect(result.error).toBe('MISSING_TOURNAMENT_RECORD');
  });
});
