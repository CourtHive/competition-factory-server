import { ConsumerRegistryService } from './consumer-registry.service';
import { ProjectorService } from './projector.service';
import { buildMidBoltHistory } from './fixtures/sample-bolt-history';

describe('ProjectorService', () => {
  let registry: ConsumerRegistryService;
  let projector: ProjectorService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    registry = new ConsumerRegistryService();
    projector = new ProjectorService(registry);
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }) as any);
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
    jest.clearAllMocks();
  });

  it('dispatches a scorebug payload to scorebug consumers', async () => {
    registry.register({
      id: 'expression-1',
      kind: 'scorebug',
      url: 'http://example.test/scorebug',
      enabled: true,
    });

    await projector.project(buildMidBoltHistory());
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://example.test/scorebug');
    const body = JSON.parse(init.body);
    expect(body.format).toBe('INTENNSE');
    expect(body.matchUpId).toBe('tie-sample-1');
    expect(body.side1.boltScore).toBe(5);
  });

  it('dispatches a video-board payload with monotonically increasing sequence', async () => {
    registry.register({
      id: 'vboard-1',
      kind: 'video-board',
      url: 'http://example.test/vboard',
      enabled: true,
    });

    await projector.project(buildMidBoltHistory());
    await projector.project(buildMidBoltHistory());
    await projector.project(buildMidBoltHistory());
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sequences = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).sequence);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it('skips disabled consumers', async () => {
    registry.register({
      id: 'expression-1',
      kind: 'scorebug',
      url: 'http://example.test/scorebug',
      enabled: false,
    });

    await projector.project(buildMidBoltHistory());
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as any);
    registry.register({
      id: 'broken',
      kind: 'scorebug',
      url: 'http://example.test/scorebug',
      enabled: true,
    });

    await expect(projector.project(buildMidBoltHistory())).resolves.toBeUndefined();
    // Wait for retries to settle so the test doesn't leave timers behind.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(fetchMock).toHaveBeenCalledTimes(3); // MAX_DISPATCH_ATTEMPTS
  });

  it('attaches Authorization header when configured', async () => {
    registry.register({
      id: 'authed',
      kind: 'scorebug',
      url: 'http://example.test/scorebug',
      authHeader: 'Bearer abc',
      enabled: true,
    });

    await projector.project(buildMidBoltHistory());
    await new Promise((resolve) => setImmediate(resolve));

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer abc');
  });

  it('skips when document has no tieMatchUpId', async () => {
    await projector.project({} as any);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('callback consumers (public-live)', () => {
    it('dispatches a public-live payload to a callback consumer in-process', async () => {
      const callback = jest.fn(async (payload: any) => {
        void payload;
      });
      registry.register({
        id: 'public-live-test',
        kind: 'public-live',
        enabled: true,
        callback,
      });

      await projector.project(buildMidBoltHistory());
      await new Promise((resolve) => setImmediate(resolve));

      expect(callback).toHaveBeenCalledTimes(1);
      const payload = callback.mock.calls[0][0];
      expect(payload.matchUpId).toBe('tie-sample-1');
      expect(payload.tournamentId).toBe('tour-sample-1');
      // No HTTP fetch for callback consumers
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not throw when a callback consumer raises', async () => {
      const callback = jest.fn(async (payload: any) => {
        void payload;
        throw new Error('callback boom');
      });
      registry.register({
        id: 'broken-callback',
        kind: 'public-live',
        enabled: true,
        callback,
      });

      await expect(projector.project(buildMidBoltHistory())).resolves.toBeUndefined();
    });

    it('skips disabled callback consumers', async () => {
      const callback = jest.fn(async (payload: any) => {
        void payload;
      });
      registry.register({
        id: 'disabled',
        kind: 'public-live',
        enabled: false,
        callback,
      });

      await projector.project(buildMidBoltHistory());
      expect(callback).not.toHaveBeenCalled();
    });

    it('dispatches to HTTP and callback consumers in the same project() call', async () => {
      const callback = jest.fn(async (payload: any) => {
        void payload;
      });
      registry.register({
        id: 'http-scorebug',
        kind: 'scorebug',
        url: 'http://example.test/scorebug',
        enabled: true,
      });
      registry.register({
        id: 'callback-public-live',
        kind: 'public-live',
        enabled: true,
        callback,
      });

      await projector.project(buildMidBoltHistory());
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('projectMatchUpFinalized (Phase 3 slice 6 — crowd writes)', () => {
    const registerInternalConsumer = () => {
      registry.register({
        id: 'score-relay-matchup-finalized',
        kind: 'matchup-finalized',
        url: 'http://example.test/api/internal/matchup-finalized',
        extraHeaders: { 'X-Internal-Secret': 'shh' },
        singleShot: true,
        enabled: true,
      });
    };

    it('POSTs exactly once per finalized matchUp with the correct body and header', async () => {
      registerInternalConsumer();

      projector.projectMatchUpFinalized([
        { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-final-1', winningSide: 1 } },
      ]);
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://example.test/api/internal/matchup-finalized');
      expect(init.method).toBe('POST');
      expect(init.headers['X-Internal-Secret']).toBe('shh');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ matchUpId: 'mu-final-1' });
    });

    it('fires for matchUpStatus COMPLETED even when winningSide is absent', async () => {
      registerInternalConsumer();

      projector.projectMatchUpFinalized([
        {
          topic: 'MODIFY_MATCHUP',
          tournamentId: 't1',
          matchUp: { matchUpId: 'mu-walkover-1', matchUpStatus: 'COMPLETED' },
        },
      ]);
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ matchUpId: 'mu-walkover-1' });
    });

    it('does not POST for non-finalizing mid-game notices', async () => {
      registerInternalConsumer();

      projector.projectMatchUpFinalized([
        {
          topic: 'MODIFY_MATCHUP',
          tournamentId: 't1',
          matchUp: { matchUpId: 'mu-mid-1', matchUpStatus: 'IN_PROGRESS', winningSide: null },
        },
      ]);
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fires once per finalized matchUp in a batch and skips non-finalizing entries', async () => {
      registerInternalConsumer();

      projector.projectMatchUpFinalized([
        { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-1', winningSide: 1 } },
        { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-2', matchUpStatus: 'IN_PROGRESS' } },
        { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-3', matchUpStatus: 'COMPLETED' } },
      ]);
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).matchUpId);
      expect(bodies.sort()).toEqual(['mu-1', 'mu-3']);
    });

    it('swallows HTTP failure without throwing and without retrying (singleShot)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as any);
      registerInternalConsumer();

      expect(() =>
        projector.projectMatchUpFinalized([
          { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-final-1', winningSide: 1 } },
        ]),
      ).not.toThrow();
      // Wait long enough that any retry would have fired (would have been ~600ms with backoff)
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('swallows a thrown fetch error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      registerInternalConsumer();

      expect(() =>
        projector.projectMatchUpFinalized([
          { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-final-1', winningSide: 1 } },
        ]),
      ).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no matchup-finalized consumer is registered (disabled state)', async () => {
      projector.projectMatchUpFinalized([
        { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-final-1', winningSide: 1 } },
      ]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does nothing when the registered consumer is disabled', async () => {
      registry.register({
        id: 'score-relay-matchup-finalized',
        kind: 'matchup-finalized',
        url: 'http://example.test/api/internal/matchup-finalized',
        extraHeaders: { 'X-Internal-Secret': 'shh' },
        singleShot: true,
        enabled: false,
      });

      projector.projectMatchUpFinalized([
        { topic: 'MODIFY_MATCHUP', tournamentId: 't1', matchUp: { matchUpId: 'mu-final-1', winningSide: 1 } },
      ]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does nothing when the notices array is empty', async () => {
      registerInternalConsumer();
      projector.projectMatchUpFinalized([]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
