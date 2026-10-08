import { SocketIoRealtimeAdapter } from '../realtime/socket-io-realtime.adapter';
import { publicTournamentChannel } from '../realtime/channels';
import { PublicGateway } from './public.gateway';

describe('PublicGateway', () => {
  let gateway: PublicGateway;
  let realtime: SocketIoRealtimeAdapter;

  afterEach(() => {
    gateway?.onModuleDestroy();
  });

  describe('without metrics', () => {
    beforeEach(() => {
      delete process.env.PUBLIC_METRICS_LOG;
      realtime = new SocketIoRealtimeAdapter();
      gateway = new PublicGateway(realtime);
    });

    it('should be defined', () => {
      expect(gateway).toBeDefined();
    });

    // Was `broadcastPublicUpdate emits to room`. Publishing moved to the realtime port; what the
    // gateway still owns is binding /public, without which nothing published reaches the room.
    it('a publicUpdate published to the public channel emits to the room once afterInit binds /public', () => {
      const emitFn = vi.fn();
      const server: any = { to: vi.fn().mockReturnValue({ emit: emitFn }) };
      gateway.afterInit(server);

      realtime.publish(publicTournamentChannel('t1'), 'publicUpdate', { type: 'matchUpUpdate' });

      expect(server.to).toHaveBeenCalledWith('public:tournament:t1');
      expect(emitFn).toHaveBeenCalledWith('publicUpdate', { type: 'matchUpUpdate' });
    });

    // The `skips when no tournamentId` case now lives with the code that decides it:
    // tournament-broadcast.service.spec.ts › 'publishes nothing for a notice with no tournamentId'.
  });

  describe('with metrics enabled', () => {
    beforeEach(() => {
      process.env.PUBLIC_METRICS_LOG = 'true';
      process.env.PUBLIC_METRICS_INTERVAL = '600000'; // long interval to avoid firing during test
      realtime = new SocketIoRealtimeAdapter();
      gateway = new PublicGateway(realtime);
    });

    afterEach(() => {
      delete process.env.PUBLIC_METRICS_LOG;
      delete process.env.PUBLIC_METRICS_INTERVAL;
    });

    it('logs connection with IP and user-agent', () => {
      const logSpy = vi.spyOn((gateway as any).logger, 'log');
      const mockClient = {
        id: 'test-socket',
        handshake: {
          address: '192.168.1.1',
          headers: { 'user-agent': 'TestApp/1.0', origin: 'https://example.com' },
        },
      };

      gateway.handleConnection(mockClient as any);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:connect]'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('ip=192.168.1.1'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('ua=TestApp/1.0'),
      );
    });

    it('logs disconnect', () => {
      const logSpy = vi.spyOn((gateway as any).logger, 'log');
      gateway.handleDisconnect({ id: 'test-socket' } as any);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:disconnect] id=test-socket'),
      );
    });

    it('logs join with tournament and room size', async () => {
      const logSpy = vi.spyOn((gateway as any).logger, 'log');
      const mockClient = {
        id: 'test-socket',
        join: vi.fn(),
      };
      (gateway as any).server = {
        in: vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue([{}, {}]) }),
      };

      await gateway.joinTournament({ tournamentId: 't1' }, mockClient as any);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:join] id=test-socket tournament=t1 roomSize=2'),
      );
    });

    it('logs metrics summary', async () => {
      const logSpy = vi.spyOn((gateway as any).logger, 'log');
      (gateway as any).server = {
        fetchSockets: vi.fn().mockResolvedValue([
          { rooms: new Set(['test-socket-id', 'public:tournament:t1']) },
          { rooms: new Set(['other-socket-id', 'public:tournament:t1', 'public:tournament:t2']) },
        ]),
      };

      await (gateway as any).logMetricsSummary();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('totalClients=2'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('activeRooms=2'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('t1=2'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('t2=1'),
      );
    });
  });
});
