import { FactoryService } from './factory.service';

const calls = vi.hoisted(() => ({ getDrawData: [] as any[], getEventData: [] as any[] }));

// The public query functions are replaced so the test sees exactly what the service hands them.
vi.mock('./functions/public', () => {
  const publicQueries = {
    getDrawData: async (params: any) => {
      calls.getDrawData.push(params);
      return {};
    },
    getEventData: async (params: any) => {
      calls.getEventData.push(params);
      return {};
    },
  };
  return { default: publicQueries, publicQueries };
});

// FactoryService.getDrawData destructured only { structuresProfile, tournamentId, drawId }, so the
// controller's `hydrateParticipants: false` (its own `|n` cache key) never reached the factory and the
// route always returned fully hydrated sides. The controller spec mocks the service and could not see it.
describe('FactoryService.getDrawData', () => {
  const service: any = Object.create(FactoryService.prototype);

  beforeEach(() => {
    calls.getDrawData.length = 0;
    calls.getEventData.length = 0;
  });

  it('forwards hydrateParticipants to the public draw query', async () => {
    await service.getDrawData({ tournamentId: 't1', drawId: 'd1', hydrateParticipants: false });
    expect(calls.getDrawData).toHaveLength(1);
    expect(calls.getDrawData[0]).toMatchObject({ tournamentId: 't1', drawId: 'd1', hydrateParticipants: false });
  });

  it('leaves hydrateParticipants undefined when the caller omits it', async () => {
    await service.getDrawData({ tournamentId: 't1', drawId: 'd1', structuresProfile: 'STUBS' });
    expect(calls.getDrawData[0].hydrateParticipants).toBeUndefined();
    expect(calls.getDrawData[0].structuresProfile).toEqual('STUBS');
  });

  it('matches the event route, which already forwarded it', async () => {
    await service.getEventData({ tournamentId: 't1', eventId: 'e1', hydrateParticipants: false });
    await service.getDrawData({ tournamentId: 't1', drawId: 'd1', hydrateParticipants: false });
    expect(calls.getEventData[0].hydrateParticipants).toEqual(calls.getDrawData[0].hydrateParticipants);
  });
});
