import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import { HttpThrottlerGuard } from './http-throttler.guard';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('applies a finite separate allowance only to the configured identity and factory routes', async () => {
  vi.stubEnv('SIMULATION_FACTORY_USER_ID', 'seeded');
  vi.stubEnv('SIMULATION_FACTORY_LIMIT_PER_MINUTE', '6000');
  const enforce = vi.spyOn(ThrottlerGuard.prototype as any, 'handleRequest').mockResolvedValue(true);
  const guard = Object.create(HttpThrottlerGuard.prototype);
  const request = (id: string, method: string) =>
    ({
      limit: 300,
      ttl: 60_000,
      context: {
        getClass: () => ({ name: 'FactoryController' }),
        getHandler: () => ({ name: method }),
        switchToHttp: () => ({ getRequest: () => ({ userContext: { userId: id } }) }),
      },
    }) as unknown as ThrottlerRequest;
  for (const method of ['executionQueue', 'queryTournamentRecords']) {
    await guard.handleRequest(request('seeded', method));
    const applied = enforce.mock.lastCall![0] as ThrottlerRequest;
    expect(applied.limit).toBe(6000);
    expect(await applied.getTracker({}, applied.context)).toBe('simulation-user:seeded');
  }
  for (const props of [request('other', 'executionQueue'), request('seeded', 'saveTournamentRecord')]) {
    await guard.handleRequest(props);
    expect(enforce).toHaveBeenLastCalledWith(props);
  }
  vi.stubEnv('SIMULATION_FACTORY_LIMIT_PER_MINUTE', 'Infinity');
  const ordinary = request('seeded', 'executionQueue');
  await guard.handleRequest(ordinary);
  expect(enforce).toHaveBeenLastCalledWith(ordinary);
});
