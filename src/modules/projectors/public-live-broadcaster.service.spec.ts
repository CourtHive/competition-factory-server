import { ConsumerRegistryService, isCallbackConsumer } from './consumer-registry.service';
import { PublicLiveBroadcaster } from './public-live-broadcaster.service';
import { PublicGateway } from 'src/modules/messaging/public/public.gateway';

describe('PublicLiveBroadcaster', () => {
  let registry: ConsumerRegistryService;
  let publicGateway: jest.Mocked<PublicGateway>;
  let broadcaster: PublicLiveBroadcaster;

  beforeEach(() => {
    registry = new ConsumerRegistryService();
    publicGateway = { broadcastLiveScore: jest.fn() } as any;
    broadcaster = new PublicLiveBroadcaster(registry, publicGateway);
  });

  it('registers itself as a callback consumer on init', () => {
    broadcaster.onModuleInit();
    const consumers = registry.list('public-live');
    expect(consumers).toHaveLength(1);
    expect(consumers[0].id).toBe('public-live-broadcaster');
    expect(consumers[0].enabled).toBe(true);
    expect(isCallbackConsumer(consumers[0])).toBe(true);
  });

  it('routes a payload to PublicGateway.broadcastLiveScore by tournamentId', async () => {
    broadcaster.onModuleInit();
    const consumer = registry.list('public-live')[0];
    if (!isCallbackConsumer(consumer)) throw new Error('expected callback consumer');

    await consumer.callback({
      matchUpId: 'tie-1',
      tournamentId: 'tour-1',
      format: 'INTENNSE',
      status: 'in_progress',
      side1: { teamName: 'A', playerName: 'A', setScores: [5], gameScore: 1, isServing: true },
      side2: { teamName: 'B', playerName: 'B', setScores: [3], gameScore: 0, isServing: false },
      generatedAt: '2026-04-10T10:00:00.000Z',
    });

    expect(publicGateway.broadcastLiveScore).toHaveBeenCalledTimes(1);
    expect(publicGateway.broadcastLiveScore).toHaveBeenCalledWith('tour-1', expect.objectContaining({
      matchUpId: 'tie-1',
      tournamentId: 'tour-1',
    }));
  });

  it('skips broadcast when payload is missing tournamentId', async () => {
    broadcaster.onModuleInit();
    const consumer = registry.list('public-live')[0];
    if (!isCallbackConsumer(consumer)) throw new Error('expected callback consumer');

    await consumer.callback({ matchUpId: 'tie-1' });
    expect(publicGateway.broadcastLiveScore).not.toHaveBeenCalled();
  });
});
