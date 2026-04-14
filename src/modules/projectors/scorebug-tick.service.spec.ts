import { ConsumerRegistryService } from './consumer-registry.service';
import { ScorebugTickService } from './scorebug-tick.service';
import { buildMidBoltHistory, buildSampleBoltHistory } from './fixtures/sample-bolt-history';

describe('ScorebugTickService', () => {
  let registry: ConsumerRegistryService;
  let service: ScorebugTickService;
  let fetchMock: jest.Mock;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    process.env.SCOREBUG_TICK_INTERVAL_MS = '250';
    registry = new ConsumerRegistryService();
    service = new ScorebugTickService(registry);
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }) as any);
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    delete (globalThis as any).fetch;
    process.env = { ...ORIGINAL_ENV };
  });

  describe('start/stop lifecycle', () => {
    it('starts ticking when document is in play state', () => {
      service.notifyDocumentUpdate(buildMidBoltHistory());
      expect(service.getActiveTickerCount()).toBe(1);
      expect(service.isTicking('tie-sample-1')).toBe(true);
    });

    it('does not start ticking when bolt has not started', () => {
      service.notifyDocumentUpdate(buildSampleBoltHistory({ boltStarted: false }));
      expect(service.getActiveTickerCount()).toBe(0);
    });

    it('stops ticking when document transitions to paused', () => {
      service.notifyDocumentUpdate(buildMidBoltHistory());
      expect(service.isTicking('tie-sample-1')).toBe(true);

      service.notifyDocumentUpdate({ ...buildMidBoltHistory(), pausedOnExit: true });
      expect(service.isTicking('tie-sample-1')).toBe(false);
    });

    it('stops ticking when document transitions to expired', () => {
      service.notifyDocumentUpdate(buildMidBoltHistory());
      service.notifyDocumentUpdate({ ...buildMidBoltHistory(), boltExpired: true });
      expect(service.isTicking('tie-sample-1')).toBe(false);
    });

    it('stops ticking when document transitions to complete', () => {
      service.notifyDocumentUpdate(buildMidBoltHistory());
      service.notifyDocumentUpdate({ ...buildMidBoltHistory(), boltComplete: true });
      expect(service.isTicking('tie-sample-1')).toBe(false);
    });

    it('restarts ticker with new anchor on subsequent in-play update', () => {
      service.notifyDocumentUpdate(buildMidBoltHistory());
      const firstHandle = (service as any).tickers.get('tie-sample-1');
      service.notifyDocumentUpdate(buildMidBoltHistory());
      const secondHandle = (service as any).tickers.get('tie-sample-1');
      expect(firstHandle).not.toBe(secondHandle);
    });

    it('tracks separate tickers for different matchUpIds', () => {
      service.notifyDocumentUpdate({ ...buildMidBoltHistory(), tieMatchUpId: 'tie-A' });
      service.notifyDocumentUpdate({ ...buildMidBoltHistory(), tieMatchUpId: 'tie-B' });
      expect(service.getActiveTickerCount()).toBe(2);
    });

    it('onModuleDestroy clears all active tickers', () => {
      service.notifyDocumentUpdate({ ...buildMidBoltHistory(), tieMatchUpId: 'tie-A' });
      service.notifyDocumentUpdate({ ...buildMidBoltHistory(), tieMatchUpId: 'tie-B' });
      service.onModuleDestroy();
      expect(service.getActiveTickerCount()).toBe(0);
    });
  });

  describe('tick emission cadence', () => {
    it('emits a tick payload to scorebug consumers on each interval', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate(buildMidBoltHistory());

      // Advance the mock clock by 250ms — one tick cycle
      jest.advanceTimersByTime(250);
      // Allow microtasks (the async fetch) to flush
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.kind).toBe('tick');
      expect(body.matchUpId).toBe('tie-sample-1');
      expect(body.tournamentId).toBe('tour-sample-1');
      expect(body.state).toBe('play');
      expect(typeof body.boltClockMs).toBe('number');
      expect(typeof body.serveClockMs).toBe('number');
    });

    it('emits multiple ticks across multiple intervals', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate(buildMidBoltHistory());

      jest.advanceTimersByTime(250);
      await Promise.resolve();
      jest.advanceTimersByTime(250);
      await Promise.resolve();
      jest.advanceTimersByTime(250);
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('extrapolates clocks downward over time', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      // Mid-bolt fixture has boltClockRemainingMs: 420000
      service.notifyDocumentUpdate(buildMidBoltHistory());

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalled();
      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      // After ~4 seconds elapsed, the bolt clock should be ~416000ms
      // (some flexibility because mock timer advances aren't perfectly aligned)
      expect(body.boltClockMs).toBeLessThan(420000);
      expect(body.boltClockMs).toBeGreaterThanOrEqual(415000);
    });

    it('auto-stops the ticker when boltClockMs reaches 0', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate({
        ...buildMidBoltHistory(),
        boltClockRemainingMs: 200,
      });

      jest.advanceTimersByTime(250);
      await Promise.resolve();
      // After the first tick, clock should be at 0 and ticker stopped
      expect(service.isTicking('tie-sample-1')).toBe(false);

      // Further advancement should not produce more ticks
      const callsAfterStop = fetchMock.mock.calls.length;
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(callsAfterStop);
    });

    it('does not throw when no scorebug consumers are registered', async () => {
      service.notifyDocumentUpdate(buildMidBoltHistory());
      jest.advanceTimersByTime(250);
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('dispatches to callback consumers in addition to HTTP', async () => {
      const callback = jest.fn(async (payload: any) => {
        void payload;
      });
      registry.register({
        id: 'callback-tick-listener',
        kind: 'scorebug',
        enabled: true,
        callback,
      });

      service.notifyDocumentUpdate(buildMidBoltHistory());
      jest.advanceTimersByTime(250);
      await Promise.resolve();

      expect(callback).toHaveBeenCalledTimes(1);
      const tick = callback.mock.calls[0][0];
      expect(tick.kind).toBe('tick');
    });

    it('does not throw when an HTTP consumer fails', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as any);
      registry.register({
        id: 'broken',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate(buildMidBoltHistory());
      expect(() => {
        jest.advanceTimersByTime(250);
      }).not.toThrow();
    });
  });

  describe('penalty box extrapolation', () => {
    it('extrapolates penalty box countdown timers downward', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate({
        ...buildMidBoltHistory(),
        penaltyBoxSnapshots: {
          charlie: { remainingMs: 120000, sideNumber: 1, participantName: 'Charlie' },
        },
      });

      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.penaltyBox).toBeDefined();
      expect(body.penaltyBox.charlie.remainingMs).toBeLessThanOrEqual(118000);
      expect(body.penaltyBox.charlie.remainingMs).toBeGreaterThanOrEqual(117000);
      expect(body.penaltyBox.charlie.sideNumber).toBe(1);
      expect(body.penaltyBox.charlie.participantName).toBe('Charlie');
    });

    it('clamps penalty box countdown at zero', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate({
        ...buildMidBoltHistory(),
        penaltyBoxSnapshots: {
          charlie: { remainingMs: 100, sideNumber: 2 },
        },
      });

      jest.advanceTimersByTime(250);
      await Promise.resolve();

      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.penaltyBox.charlie.remainingMs).toBe(0);
    });

    it('omits penaltyBox when no snapshots exist', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate(buildMidBoltHistory());

      jest.advanceTimersByTime(250);
      await Promise.resolve();

      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.penaltyBox).toBeUndefined();
    });

    it('includes multiple penalized players from both sides', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate({
        ...buildMidBoltHistory(),
        penaltyBoxSnapshots: {
          alice: { remainingMs: 60000, sideNumber: 1, participantName: 'Alice' },
          bob: { remainingMs: 90000, sideNumber: 2, participantName: 'Bob' },
        },
      });

      jest.advanceTimersByTime(250);
      await Promise.resolve();

      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(Object.keys(body.penaltyBox)).toHaveLength(2);
      expect(body.penaltyBox.alice.sideNumber).toBe(1);
      expect(body.penaltyBox.bob.sideNumber).toBe(2);
    });
  });

  describe('player clock extrapolation', () => {
    it('accrues additional time on on-court players, leaves benched players alone', async () => {
      registry.register({
        id: 'expression',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      service.notifyDocumentUpdate({
        ...buildMidBoltHistory(),
        playerTimeSnapshots: {
          alice: { elapsedMs: 60000, isOnCourt: true },
          bob: { elapsedMs: 30000, isOnCourt: false },
        },
      });

      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.playerClocks.alice.remainingMs).toBeGreaterThanOrEqual(61000);
      expect(body.playerClocks.alice.isOnCourt).toBe(true);
      // Bob is benched — no accrual
      expect(body.playerClocks.bob.remainingMs).toBe(30000);
      expect(body.playerClocks.bob.isOnCourt).toBe(false);
    });
  });
});
