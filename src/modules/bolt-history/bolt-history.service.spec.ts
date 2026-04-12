import { BoltHistoryDocument, IBoltHistoryStorage } from 'src/storage/interfaces/bolt-history.interface';
import { IBoltHistoryReporting } from 'src/storage/interfaces/bolt-history-reporting.interface';
import { OutboundQueueService } from 'src/modules/relay/outbound-queue.service';
import { TournamentBroadcastService } from 'src/modules/messaging/broadcast/tournament-broadcast.service';
import { ProjectorService } from 'src/modules/projectors/projector.service';
import { FactoryService } from 'src/modules/factory/factory.service';
import { BoltHistoryService } from './bolt-history.service';
import { RelayConfig } from 'src/modules/relay/relay.config';

const buildDocument = (overrides: Partial<BoltHistoryDocument> = {}): BoltHistoryDocument => ({
  tieMatchUpId: 'tie-1',
  parentMatchUpId: 'parent-1',
  tournamentId: 'tour-1',
  sides: [
    { sideNumber: 1, participant: { participantId: 'p1', participantName: 'Alice' } },
    { sideNumber: 2, participant: { participantId: 'p2', participantName: 'Bob' } },
  ],
  engineState: { score: { sets: [] }, history: { points: [] } },
  boltStarted: false,
  boltExpired: false,
  boltComplete: false,
  timeoutsUsed: { 1: 0, 2: 0 },
  pausedOnExit: false,
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
  version: 0,
  ...overrides,
});

describe('BoltHistoryService', () => {
  let storage: jest.Mocked<IBoltHistoryStorage>;
  let reporting: jest.Mocked<IBoltHistoryReporting>;
  let projector: jest.Mocked<ProjectorService>;
  let broadcast: jest.Mocked<TournamentBroadcastService>;
  let outboundQueue: jest.Mocked<OutboundQueueService>;
  let factoryService: jest.Mocked<FactoryService>;
  let relayConfig: RelayConfig;
  let service: BoltHistoryService;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    storage = {
      findBoltHistory: jest.fn(),
      saveBoltHistory: jest.fn(),
      listBoltHistoryForTournament: jest.fn(),
      removeBoltHistory: jest.fn(),
    };
    reporting = {
      getPlayerPointStats: jest.fn(),
      getTournamentLeaders: jest.fn(),
    };
    projector = { project: jest.fn(async () => undefined) } as any;
    broadcast = { broadcastBoltHistory: jest.fn() } as any;
    outboundQueue = { enqueue: jest.fn(async () => undefined) } as any;
    factoryService = { getMatchUps: jest.fn() } as any;

    process.env.INSTANCE_ROLE = 'local';
    process.env.LOCAL_VENUE_ID = 'venue-test';
    process.env.CLOUD_RELAY_URL = 'https://relay.example.test';
    relayConfig = new RelayConfig();

    service = new BoltHistoryService(
      storage,
      reporting,
      projector,
      broadcast,
      relayConfig,
      factoryService,
      outboundQueue,
    );
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
  });

  describe('upsert', () => {
    it('returns the storage error and skips side-effects on save failure', async () => {
      storage.saveBoltHistory.mockResolvedValue({ error: 'VERSION_CONFLICT' });
      const result = await service.upsert(buildDocument());
      expect(result.error).toBe('VERSION_CONFLICT');
      expect(broadcast.broadcastBoltHistory).not.toHaveBeenCalled();
      expect(projector.project).not.toHaveBeenCalled();
      expect(outboundQueue.enqueue).not.toHaveBeenCalled();
    });

    it('broadcasts, projects, and enqueues on successful save', async () => {
      storage.saveBoltHistory.mockResolvedValue({ success: true, version: 3 });
      const result = await service.upsert(buildDocument({ version: 2 }));
      // Allow fire-and-forget side-effects to flush
      await new Promise((resolve) => setImmediate(resolve));

      expect(result.success).toBe(true);
      expect(result.version).toBe(3);
      expect(broadcast.broadcastBoltHistory).toHaveBeenCalledWith(
        'tour-1',
        expect.objectContaining({ tieMatchUpId: 'tie-1', version: 3 }),
      );
      expect(projector.project).toHaveBeenCalledWith(
        expect.objectContaining({ tieMatchUpId: 'tie-1', version: 3 }),
      );
      expect(outboundQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          venueId: 'venue-test',
          kind: 'bolt-history',
          matchUpId: 'tie-1',
        }),
      );
    });

    it('does not enqueue when relay role is cloud', async () => {
      process.env.INSTANCE_ROLE = 'cloud';
      relayConfig = new RelayConfig();
      service = new BoltHistoryService(
        storage,
        reporting,
        projector,
        broadcast,
        relayConfig,
        factoryService,
        outboundQueue,
      );
      storage.saveBoltHistory.mockResolvedValue({ success: true, version: 1 });

      await service.upsert(buildDocument());
      await new Promise((resolve) => setImmediate(resolve));

      expect(outboundQueue.enqueue).not.toHaveBeenCalled();
    });

    it('does not enqueue when CLOUD_RELAY_URL is unset', async () => {
      delete process.env.CLOUD_RELAY_URL;
      relayConfig = new RelayConfig();
      service = new BoltHistoryService(
        storage,
        reporting,
        projector,
        broadcast,
        relayConfig,
        factoryService,
        outboundQueue,
      );
      storage.saveBoltHistory.mockResolvedValue({ success: true, version: 1 });

      await service.upsert(buildDocument());
      await new Promise((resolve) => setImmediate(resolve));

      expect(outboundQueue.enqueue).not.toHaveBeenCalled();
    });

    it('works without an injected outbound queue', async () => {
      service = new BoltHistoryService(
        storage,
        reporting,
        projector,
        broadcast,
        relayConfig,
        factoryService,
      );
      storage.saveBoltHistory.mockResolvedValue({ success: true, version: 1 });

      await expect(service.upsert(buildDocument())).resolves.toEqual({ success: true, version: 1 });
      await new Promise((resolve) => setImmediate(resolve));
      expect(broadcast.broadcastBoltHistory).toHaveBeenCalled();
      expect(projector.project).toHaveBeenCalled();
    });
  });

  describe('find', () => {
    it('delegates to storage', async () => {
      storage.findBoltHistory.mockResolvedValue({ document: buildDocument({ version: 5 }) });
      const result = await service.find('tie-1');
      expect(result.document?.version).toBe(5);
      expect(storage.findBoltHistory).toHaveBeenCalledWith({ tieMatchUpId: 'tie-1' });
    });
  });

  describe('listForTournament', () => {
    it('delegates to storage', async () => {
      const docs = [buildDocument(), buildDocument({ tieMatchUpId: 'tie-2' })];
      storage.listBoltHistoryForTournament.mockResolvedValue({ documents: docs });
      const result = await service.listForTournament('tour-1');
      expect(result.documents).toHaveLength(2);
    });
  });

  describe('remove', () => {
    it('delegates to storage', async () => {
      storage.removeBoltHistory.mockResolvedValue({ success: true });
      const result = await service.remove('tie-1');
      expect(result.success).toBe(true);
    });
  });

  describe('getParentMatchUp', () => {
    it('rejects empty tieMatchUpId', async () => {
      const result = await service.getParentMatchUp('');
      expect(result.error).toMatch(/tieMatchUpId/);
    });

    it('returns Bolt history not found when storage misses', async () => {
      storage.findBoltHistory.mockResolvedValue({ error: 'Bolt history not found' });
      const result = await service.getParentMatchUp('tie-1');
      expect(result.error).toBe('Bolt history not found');
    });

    it('returns the parent matchUp from the factory query result', async () => {
      storage.findBoltHistory.mockResolvedValue({
        document: buildDocument({ parentMatchUpId: 'parent-1', tournamentId: 'tour-1' }),
      });
      factoryService.getMatchUps.mockResolvedValue({
        matchUps: [
          { matchUpId: 'parent-1', matchUpType: 'TEAM', tieMatchUps: [{ matchUpId: 'tie-1' }] },
          { matchUpId: 'parent-2', matchUpType: 'TEAM' },
        ],
      } as any);

      const result = await service.getParentMatchUp('tie-1');
      expect(result.teamMatchUp?.matchUpId).toBe('parent-1');
      expect(factoryService.getMatchUps).toHaveBeenCalledWith({
        tournamentId: 'tour-1',
        matchUpFilters: { matchUpIds: ['parent-1'] },
      });
    });

    it('falls back to upcomingMatchUps when matchUps is empty', async () => {
      storage.findBoltHistory.mockResolvedValue({
        document: buildDocument({ parentMatchUpId: 'parent-1', tournamentId: 'tour-1' }),
      });
      factoryService.getMatchUps.mockResolvedValue({
        upcomingMatchUps: [{ matchUpId: 'parent-1', matchUpType: 'TEAM' }],
      } as any);

      const result = await service.getParentMatchUp('tie-1');
      expect(result.teamMatchUp?.matchUpId).toBe('parent-1');
    });

    it('returns Parent matchUp not found when factory has no match', async () => {
      storage.findBoltHistory.mockResolvedValue({
        document: buildDocument({ parentMatchUpId: 'parent-missing', tournamentId: 'tour-1' }),
      });
      factoryService.getMatchUps.mockResolvedValue({ matchUps: [] } as any);

      const result = await service.getParentMatchUp('tie-1');
      expect(result.error).toBe('Parent matchUp not found in tournament');
    });

    it('propagates factory errors', async () => {
      storage.findBoltHistory.mockResolvedValue({
        document: buildDocument({ parentMatchUpId: 'parent-1', tournamentId: 'tour-1' }),
      });
      factoryService.getMatchUps.mockResolvedValue({ error: 'engine boom' } as any);

      const result = await service.getParentMatchUp('tie-1');
      expect(result.error).toBe('engine boom');
    });

    it('returns error when document is missing tournamentId', async () => {
      storage.findBoltHistory.mockResolvedValue({
        document: buildDocument({ tournamentId: '', parentMatchUpId: 'parent-1' }),
      });
      const result = await service.getParentMatchUp('tie-1');
      expect(result.error).toMatch(/tournamentId|parentMatchUpId/);
    });
  });

  describe('reporting delegation', () => {
    it('delegates getPlayerPointStats to the reporting adapter', async () => {
      reporting.getPlayerPointStats.mockResolvedValue({
        stats: {
          participantId: 'p1',
          pointsWon: 12,
          pointsPlayed: 20,
          winRate: 0.6,
          matchUpsParticipated: 2,
        },
      });
      const result = await service.getPlayerPointStats({ participantId: 'p1', tournamentId: 'tour-1' });
      expect(result.stats?.pointsWon).toBe(12);
      expect(reporting.getPlayerPointStats).toHaveBeenCalledWith({
        participantId: 'p1',
        tournamentId: 'tour-1',
      });
    });

    it('delegates getTournamentLeaders to the reporting adapter', async () => {
      reporting.getTournamentLeaders.mockResolvedValue({
        leaders: [
          { participantId: 'p1', participantName: 'Alice', pointsWon: 30, matchUpsParticipated: 2 },
          { participantId: 'p2', participantName: 'Bob', pointsWon: 18, matchUpsParticipated: 2 },
        ],
      });
      const result = await service.getTournamentLeaders({ tournamentId: 'tour-1', limit: 5 });
      expect(result.leaders).toHaveLength(2);
      expect(reporting.getTournamentLeaders).toHaveBeenCalledWith({
        tournamentId: 'tour-1',
        limit: 5,
      });
    });
  });
});
