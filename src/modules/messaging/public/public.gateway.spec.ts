import { PublicGateway } from './public.gateway';

describe('PublicGateway', () => {
  let gateway: PublicGateway;

  afterEach(() => {
    gateway?.onModuleDestroy();
  });

  describe('without metrics', () => {
    beforeEach(() => {
      delete process.env.PUBLIC_METRICS_LOG;
      gateway = new PublicGateway();
    });

    it('should be defined', () => {
      expect(gateway).toBeDefined();
    });

    it('broadcastPublicUpdate emits to room', () => {
      const emitFn = jest.fn();
      (gateway as any).server = { to: jest.fn().mockReturnValue({ emit: emitFn }) };

      gateway.broadcastPublicUpdate('t1', { type: 'matchUpUpdate' });

      expect((gateway as any).server.to).toHaveBeenCalledWith('public:tournament:t1');
      expect(emitFn).toHaveBeenCalledWith('publicUpdate', { type: 'matchUpUpdate' });
    });

    it('broadcastPublicUpdate skips when no tournamentId', () => {
      const emitFn = jest.fn();
      (gateway as any).server = { to: jest.fn().mockReturnValue({ emit: emitFn }) };

      gateway.broadcastPublicUpdate('', { type: 'matchUpUpdate' });

      expect((gateway as any).server.to).not.toHaveBeenCalled();
    });
  });

  describe('with metrics enabled', () => {
    beforeEach(() => {
      process.env.PUBLIC_METRICS_LOG = 'true';
      process.env.PUBLIC_METRICS_INTERVAL = '600000'; // long interval to avoid firing during test
      gateway = new PublicGateway();
    });

    afterEach(() => {
      delete process.env.PUBLIC_METRICS_LOG;
      delete process.env.PUBLIC_METRICS_INTERVAL;
    });

    it('logs connection with IP and user-agent', () => {
      const logSpy = jest.spyOn((gateway as any).logger, 'log');
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
      const logSpy = jest.spyOn((gateway as any).logger, 'log');
      gateway.handleDisconnect({ id: 'test-socket' } as any);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:disconnect] id=test-socket'),
      );
    });

    it('logs join with tournament and room size', async () => {
      const logSpy = jest.spyOn((gateway as any).logger, 'log');
      const mockClient = {
        id: 'test-socket',
        join: jest.fn(),
      };
      (gateway as any).server = {
        in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([{}, {}]) }),
      };

      await gateway.joinTournament({ tournamentId: 't1' }, mockClient as any);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:join] id=test-socket tournament=t1 roomSize=2'),
      );
    });

    it('logs metrics summary', async () => {
      const logSpy = jest.spyOn((gateway as any).logger, 'log');
      (gateway as any).server = {
        fetchSockets: jest.fn().mockResolvedValue([
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
