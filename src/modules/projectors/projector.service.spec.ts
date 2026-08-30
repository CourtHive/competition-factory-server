import type { Mock, MockInstance } from 'vitest';
import { Logger } from '@nestjs/common';

import { ConsumerRegistryService } from './consumer-registry.service';
import { ProjectorService } from './projector.service';

describe('ProjectorService', () => {
  let registry: ConsumerRegistryService;
  let projector: ProjectorService;
  let fetchMock: Mock;

  // Registry emits consumer-registration lines at log level; these specs
  // assert on dispatch behaviour, not log output, so silence the noise.
  let logSpy: MockInstance;
  let warnSpy: MockInstance;
  beforeAll(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  beforeEach(() => {
    registry = new ConsumerRegistryService();
    projector = new ProjectorService(registry);
    fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
    vi.clearAllMocks();
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
