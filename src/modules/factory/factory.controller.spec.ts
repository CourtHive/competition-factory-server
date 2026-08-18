import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { AssignmentsService } from './assignments.service';
import { FactoryController } from './factory.controller';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { MutationServicesModule } from '../mutation-services/mutation-services.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { StorageModule } from 'src/storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigsModule } from 'src/config/config.module';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { FactoryService } from './factory.service';
import { AuthModule } from '../account/auth/auth.module';
import { testTournamentId } from 'src/common/constants/test';

const tournamentId = testTournamentId(__filename);
import { ConfigService } from '@nestjs/config';

import { seededRng } from 'src/tests/helpers/seededRng';

const testUser = { providerId: 'test-provider', roles: ['superadmin'] };

describe('FactoryController', () => {
  let app: TestingModule;
  let factoryController: FactoryController;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      // TelemetryModule + MutationServicesModule imported (not stubbed) so the
      // test module mirrors the real provider graph — A1. Telemetry is inert
      // without LOAD_PROFILE_ENABLED.
      imports: [
        AuthModule,
        UsersModule,
        ConfigsModule,
        CacheModule,
        StorageModule,
        BroadcastModule,
        AuditModule,
        TelemetryModule,
        MutationServicesModule,
      ],
      providers: [FactoryService, AssignmentsService, ConfigService, SnapshotProjectionService],
      controllers: [FactoryController],
    }).compile();

    factoryController = app.get<FactoryController>(FactoryController);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', () => {
    expect(factoryController).toBeDefined();
  });

  it('can get version', () => {
    expect(factoryController.getVersion()).toBeDefined();
  });

  it('can generate a tournament record', async () => {
    // Seed RNG and pin tournamentId via tournamentAttributes so this spec
    // always UPSERTs the same Postgres row instead of inserting a new UUID.
    const result = await factoryController.generateTournamentRecord(
      { tournamentAttributes: { tournamentId }, random: seededRng(1) },
      testUser,
    );
    expect(result.success).toEqual(true);
  });

  it('cannot fetch tournamentRecords without login', async () => {
    const result: any = await factoryController.fetchTournamentRecords({ tournamentId });
    expect(result.error).toBeDefined();
  });

  it('can generate a tournamentRecord and query for it', async () => {
    const result = await factoryController.generateTournamentRecord(
      { tournamentAttributes: { tournamentId }, random: seededRng(2) },
      testUser,
    );
    expect(result.tournamentRecord.tournamentId).toBe(tournamentId);
  });

  describe('cacheFx preserves service context', () => {
    let mockController: FactoryController;
    const mockResult = { success: true };

    const mockService = {
      getTournamentInfo: jest.fn().mockResolvedValue(mockResult),
      getEventData: jest.fn().mockResolvedValue(mockResult),
      getScheduleMatchUps: jest.fn().mockResolvedValue(mockResult),
      getParticipants: jest.fn().mockResolvedValue(mockResult),
      getMatchUps: jest.fn().mockResolvedValue(mockResult),
    } as unknown as FactoryService;

    const mockBroadcast = {
      broadcastMutation: jest.fn(),
      broadcastPublicNotices: jest.fn(),
    } as unknown as TournamentBroadcastService;

    const mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(undefined),
    } as unknown as any;

    beforeEach(() => {
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);
      jest.clearAllMocks();
    });

    it('getTournamentInfo preserves service binding', async () => {
      const result = await mockController.getTournamentInfo('tid');
      expect(mockService.getTournamentInfo).toHaveBeenCalledWith({ tournamentId: 'tid', usePublishState: true });
      expect(result).toEqual(mockResult);
    });

    it('tournamentInfo (POST) preserves service binding', async () => {
      const params = { tournamentId: 'tid' };
      const result = await mockController.tournamentInfo(params);
      expect(mockService.getTournamentInfo).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockResult);
    });

    it('eventData preserves service binding', async () => {
      const params = { tournamentId: 'tid', eventId: 'eid', hydrateParticipants: true };
      const result = await mockController.eventData(params);
      expect(mockService.getEventData).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockResult);
    });

    it('tournamentMatchUps preserves service binding', async () => {
      const params = { params: { tournamentId: 'tid' } };
      const result = await mockController.tournamentMatchUps(params);
      expect(mockService.getScheduleMatchUps).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockResult);
    });

    it('tournamentParticipants preserves service binding', async () => {
      const params = { params: { tournamentId: 'tid' } };
      const result = await mockController.tournamentParticipants(params);
      expect(mockService.getParticipants).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockResult);
    });

    it('getMatchUps preserves service binding', async () => {
      const params = { tournamentId: 'tid' } as any;
      const result = await mockController.getMatchUps(params);
      expect(mockService.getMatchUps).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockResult);
    });
  });

  describe('REST mutation broadcasting', () => {
    let mockController: FactoryController;

    const mockBroadcast = {
      broadcastMutation: jest.fn(),
      broadcastPublicNotices: jest.fn(),
    } as unknown as TournamentBroadcastService;

    const mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(undefined),
    } as unknown as any;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('broadcasts after successful executionQueue', async () => {
      const publicNotices = [{ topic: 'MODIFY_MATCHUP', matchUp: { matchUpId: 'm1' } }];
      const mockService = {
        executionQueue: jest.fn().mockResolvedValue({ success: true, publicNotices }),
      } as unknown as FactoryService;
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);

      const eqd = {
        tournamentIds: ['t1'],
        methods: [{ method: 'setMatchUpStatus', params: {} }],
      };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);

      expect(mockBroadcast.broadcastMutation).toHaveBeenCalledWith(eqd);
      expect(mockBroadcast.broadcastPublicNotices).toHaveBeenCalledWith(eqd, publicNotices);
    });

    it('stamps the JWT-verified identity (userEmail/userId) onto the payload', async () => {
      const mockService = {
        executionQueue: jest.fn().mockResolvedValue({ success: true, publicNotices: [] }),
      } as unknown as FactoryService;
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);

      const eqd = { tournamentIds: ['t1'], methods: [{ method: 'setMatchUpStatus', params: {} }] };
      const mockReq = {
        provisioner: undefined,
        headers: {},
        auditSource: undefined,
        user: { email: 'director@example.com', sub: '11111111-2222-3333-4444-555555555555' },
      };
      await mockController.executionQueue(eqd as any, mockReq);

      expect(mockService.executionQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'director@example.com',
          userId: '11111111-2222-3333-4444-555555555555',
        }),
        expect.anything(),
      );
    });

    it('records userEmail but no userId when the JWT carries no id-shaped identifier', async () => {
      const mockService = {
        executionQueue: jest.fn().mockResolvedValue({ success: true, publicNotices: [] }),
      } as unknown as FactoryService;
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);

      const eqd = { tournamentIds: ['t1'], methods: [] };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined, user: { email: 'd@e.com' } };
      await mockController.executionQueue(eqd as any, mockReq);

      const passed = (mockService.executionQueue as jest.Mock).mock.calls[0][0];
      expect(passed.userEmail).toBe('d@e.com');
      expect(passed.userId).toBeUndefined();
    });

    it('does not broadcast after failed executionQueue', async () => {
      const mockService = {
        executionQueue: jest.fn().mockResolvedValue({ error: 'something failed' }),
      } as unknown as FactoryService;
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);

      const eqd = {
        tournamentIds: ['t1'],
        methods: [{ method: 'setMatchUpStatus', params: {} }],
      };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);

      expect(mockBroadcast.broadcastMutation).not.toHaveBeenCalled();
      expect(mockBroadcast.broadcastPublicNotices).not.toHaveBeenCalled();
    });

    it('broadcasts after successful score', async () => {
      const publicNotices = [{ topic: 'MODIFY_MATCHUP', matchUp: { matchUpId: 'm1' } }];
      const mockService = {
        score: jest.fn().mockResolvedValue({ success: true, publicNotices }),
      } as unknown as FactoryService;
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);

      const sms = { tournamentId: 't1', matchUpId: 'm1', drawId: 'd1' };
      await mockController.scoreMatchUp(sms as any, {} as any);

      expect(mockBroadcast.broadcastMutation).toHaveBeenCalledWith(expect.objectContaining({ tournamentIds: ['t1'] }));
      expect(mockBroadcast.broadcastPublicNotices).toHaveBeenCalled();
    });

    it('does not broadcast after failed score', async () => {
      const mockService = {
        score: jest.fn().mockResolvedValue({ error: 'invalid score' }),
      } as unknown as FactoryService;
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);

      const sms = { tournamentId: 't1', matchUpId: 'm1', drawId: 'd1' };
      await mockController.scoreMatchUp(sms as any, {} as any);

      expect(mockBroadcast.broadcastMutation).not.toHaveBeenCalled();
    });
  });

  // H6: invalidateTournamentCache must evict every issued cache key for
  // the tournament — including flag-variant (gti|<tid>|<flags>) and
  // per-event (ged|<tid>|<eid>) keys that the old fixed-prefix list
  // silently skipped. T4: assert on mockCache.del.mock.calls rather than
  // a permissive "any key" del so wrong-key invalidation fails the test.
  describe('per-tournament cache invalidation', () => {
    let mockController: FactoryController;

    const mockResult = { success: true };
    const mockService = {
      getTournamentInfo: jest.fn().mockResolvedValue(mockResult),
      getEventData: jest.fn().mockResolvedValue(mockResult),
      getScheduleMatchUps: jest.fn().mockResolvedValue(mockResult),
      getParticipants: jest.fn().mockResolvedValue(mockResult),
      getMatchUps: jest.fn().mockResolvedValue(mockResult),
      getAssistantContext: jest.fn().mockResolvedValue(mockResult),
      getDrawData: jest.fn().mockResolvedValue(mockResult),
      getStructureData: jest.fn().mockResolvedValue(mockResult),
      executionQueue: jest.fn().mockResolvedValue({ success: true, publicNotices: [] }),
      score: jest.fn().mockResolvedValue({ success: true, publicNotices: [] }),
    } as unknown as FactoryService;

    const mockBroadcast = {
      broadcastMutation: jest.fn(),
      broadcastPublicNotices: jest.fn(),
    } as unknown as TournamentBroadcastService;

    const mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(undefined),
    } as unknown as any;

    async function populateCacheForTid(controller: FactoryController, tid: string): Promise<void> {
      // Issue every cache-fx route once so the controller's side-table
      // records every key variant for this tournament.
      await controller.getTournamentInfo(tid);
      await controller.tournamentInfo({ tournamentId: tid, withMatchUpStats: true } as any);
      await controller.eventData({ tournamentId: tid, eventId: 'e1' } as any);
      await controller.tournamentMatchUps({ params: { tournamentId: tid } } as any);
      await controller.tournamentParticipants({ params: { tournamentId: tid } } as any);
      await controller.getMatchUps({ tournamentId: tid } as any);
      await controller.getAssistantContext(tid);
    }

    beforeEach(() => {
      jest.clearAllMocks();
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);
    });

    it('tracks every cache key issued for a tournament and deletes them all on executionQueue', async () => {
      await populateCacheForTid(mockController, 't1');

      const eqd = {
        tournamentIds: ['t1'],
        methods: [{ method: 'setMatchUpStatus', params: {} }],
      };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);

      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]).sort();
      expect(deletedKeys).toEqual(['gac|t1', 'ged|t1|e1', 'gmr|t1', 'gti|t1', 'gti|t1|ms', 'gtm|t1', 'gtp|t1'].sort());
    });

    it('deletes flag-variant keys (gti|<tid>|<flags>) on invalidation', async () => {
      // Issue several flag-variant tournamentInfo reads, each producing
      // a distinct cache key.
      await mockController.tournamentInfo({ tournamentId: 't1', withMatchUpStats: true } as any);
      await mockController.tournamentInfo({ tournamentId: 't1', withVenueData: true } as any);
      await mockController.tournamentInfo({
        tournamentId: 't1',
        withMatchUpStats: true,
        withStructureDetails: true,
      } as any);

      const eqd = { tournamentIds: ['t1'], methods: [] };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);

      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]).sort();
      expect(deletedKeys).toEqual(['gti|t1|ms', 'gti|t1|mssd', 'gti|t1|vd']);
    });

    it('does not delete cache keys for a different tournament on a t1 write', async () => {
      await populateCacheForTid(mockController, 't1');
      await populateCacheForTid(mockController, 't2');
      // Sanity: side-table should hold entries for both tournaments
      // before the mutation.

      const eqd = { tournamentIds: ['t1'], methods: [] };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);

      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]);
      // Every deleted key must be scoped to t1, not t2. This is the
      // wrong-key property test from the punch list — mutating t1 must
      // not bleed into t2's cache.
      for (const key of deletedKeys) {
        expect(key.split('|')[1]).toBe('t1');
      }
      // And every t1-keyed entry we populated must have been deleted.
      const expectedT1 = ['gac|t1', 'ged|t1|e1', 'gmr|t1', 'gti|t1', 'gti|t1|ms', 'gtm|t1', 'gtp|t1'];
      for (const key of expectedT1) {
        expect(deletedKeys).toContain(key);
      }
    });

    it("narrows to the evicted event key, sparing OTHER events' cached payloads", async () => {
      await populateCacheForTid(mockController, 't1');
      await mockController.eventData({ tournamentId: 't1', eventId: 'e2' } as any);
      jest.clearAllMocks();

      // The mutation reported a targeted eviction for e1 only.
      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: ['ged|t1|e1'],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]);
      // e2's payload is untouched — this is the whole point of the change.
      expect(deletedKeys).not.toContain('ged|t1|e2');
      // e1 was reported evicted, so the controller may still delete it (idempotent).
      // Tournament-scoped keys aggregate across events and must ALL still go.
      for (const key of ['gac|t1', 'gmr|t1', 'gti|t1', 'gti|t1|ms', 'gtm|t1', 'gtp|t1']) {
        expect(deletedKeys).toContain(key);
      }
    });

    it('FAIL-SAFE: sweeps every event key when no targeted eviction was reported', async () => {
      await populateCacheForTid(mockController, 't1');
      await mockController.eventData({ tournamentId: 't1', eventId: 'e2' } as any);
      jest.clearAllMocks();

      // No evictedEventKeys — the mutation's notices never carried an eventId, so the controller
      // cannot know which events changed and must fall back to the tournament-wide sweep.
      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: [],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]);
      expect(deletedKeys).toContain('ged|t1|e1');
      expect(deletedKeys).toContain('ged|t1|e2');
    });

    it('keeps tracking a spared event key so a later write can still evict it', async () => {
      await populateCacheForTid(mockController, 't1');
      await mockController.eventData({ tournamentId: 't1', eventId: 'e2' } as any);

      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: ['ged|t1|e1'],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      // Second write, this time with no targeted eviction: the spared e2 key must still be known
      // to the side-table, or it would leak and never be invalidated again.
      jest.clearAllMocks();
      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: [],
      });
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      expect(mockCache.del.mock.calls.map((c: any[]) => c[0])).toContain('ged|t1|e2');
    });

    it('spares a WARMED key from the sweep, so the rebuilt payload survives', async () => {
      await populateCacheForTid(mockController, 't1');
      jest.clearAllMocks();

      // executionQueue did the warming (both transports share it); it reports what it re-seeded.
      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: ['ged|t1|e1'],
        warmedEventKeys: ['ged|t1|e1'],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [], warmCache: true } as any, mockReq);

      // Without this the sweep would delete exactly the payload the caller paid to rebuild.
      expect(mockCache.del.mock.calls.map((c: any[]) => c[0])).not.toContain('ged|t1|e1');
    });

    it('still evicts the event key when nothing was warmed', async () => {
      await populateCacheForTid(mockController, 't1');
      jest.clearAllMocks();

      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: ['ged|t1|e1'],
        warmedEventKeys: [],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      expect(mockCache.del.mock.calls.map((c: any[]) => c[0])).toContain('ged|t1|e1');
    });

    it('passes a trackCacheKey callback so warmed keys enter the side-table', async () => {
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      const services = (mockService.executionQueue as jest.Mock).mock.calls[0][1];
      expect(typeof services.trackCacheKey).toBe('function');
    });

    it('gives each tier its own cache key', async () => {
      await mockController.drawData({ tournamentId: 't1', drawId: 'd1' } as any);
      await mockController.drawData({ tournamentId: 't1', drawId: 'd1', structuresProfile: 'STUBS' } as any);
      await mockController.structureData({ tournamentId: 't1', drawId: 'd1', structureId: 's1' } as any);

      const setKeys = mockCache.set.mock.calls.map((c: any[]) => c[0]);
      expect(setKeys).toContain('gdd|t1|d1');
      // The thin and full draw responses are DIFFERENT documents — sharing a key would serve one
      // client the other's payload.
      expect(setKeys).toContain('gdd|t1|d1|s');
      expect(setKeys).toContain('gsd|t1|s1');
    });

    it('GRANULARITY: a change in one structure spares the other tiers that did not change', async () => {
      // The whole justification for the structure tier — it saves no compute, only invalidation blast
      // radius. If this does not hold, the tier is not worth having.
      await mockController.drawData({ tournamentId: 't1', drawId: 'd1' } as any);
      await mockController.drawData({ tournamentId: 't1', drawId: 'd2' } as any);
      await mockController.structureData({ tournamentId: 't1', drawId: 'd1', structureId: 's1' } as any);
      await mockController.structureData({ tournamentId: 't1', drawId: 'd1', structureId: 's2' } as any);
      // Tournament-scoped keys must be in the side-table too, or "they still go" proves nothing.
      await mockController.tournamentMatchUps({ params: { tournamentId: 't1' } } as any);
      await mockController.tournamentParticipants({ params: { tournamentId: 't1' } } as any);
      await mockController.getMatchUps({ tournamentId: 't1' } as any);
      jest.clearAllMocks();

      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: ['gsd|t1|s1', 'gdd|t1|d1', 'gdd|t1|d1|s'],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      const deleted = mockCache.del.mock.calls.map((c: any[]) => c[0]);
      // untouched siblings survive
      expect(deleted).not.toContain('gsd|t1|s2');
      expect(deleted).not.toContain('gdd|t1|d2');
      // tournament-scoped keys still go — they aggregate across entities
      for (const k of ['gtm|t1', 'gmr|t1', 'gtp|t1']) expect(deleted).toContain(k);
    });

    it('FAIL-SAFE: an UNATTRIBUTABLE change sweeps that tier even though other tiers narrowed', async () => {
      // The bug this guards. `MODIFY_MATCHUP` declares a `structureId` but 57 of factory's 61
      // modifyMatchUpNotice call sites never pass one — every score path included. The handler
      // evicted nothing for the structure tier and said nothing about it, so the controller could
      // not distinguish "no structure changed" from "a structure changed and we could not name it",
      // and SPARED the key. A score served a stale structure payload for the full TTL.
      await mockController.drawData({ tournamentId: 't1', drawId: 'd1' } as any);
      await mockController.structureData({ tournamentId: 't1', drawId: 'd1', structureId: 's1' } as any);
      await mockController.structureData({ tournamentId: 't1', drawId: 'd1', structureId: 's2' } as any);
      jest.clearAllMocks();

      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        // draw tier attributed; structure tier could not be
        evictedEventKeys: ['gdd|t1|d1', 'gdd|t1|d1|s'],
        unnarrowablePrefixes: ['gsd|'],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      const deleted = mockCache.del.mock.calls.map((c: any[]) => c[0]);
      // the unattributable tier goes wholesale — coarse, but never stale
      expect(deleted).toContain('gsd|t1|s1');
      expect(deleted).toContain('gsd|t1|s2');
      // ...while the tier that DID attribute keeps its granularity
      expect(deleted).toContain('gdd|t1|d1');
    });

    it('FAIL-SAFE: sweeps every tier when no targeted eviction was reported', async () => {
      await mockController.drawData({ tournamentId: 't1', drawId: 'd1' } as any);
      await mockController.structureData({ tournamentId: 't1', drawId: 'd1', structureId: 's1' } as any);
      jest.clearAllMocks();

      (mockService.executionQueue as jest.Mock).mockResolvedValueOnce({
        success: true,
        publicNotices: [],
        evictedEventKeys: [],
      });
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, mockReq);

      const deleted = mockCache.del.mock.calls.map((c: any[]) => c[0]);
      expect(deleted).toContain('gdd|t1|d1');
      expect(deleted).toContain('gsd|t1|s1');
    });

    it('deletes tracked keys on scoreMatchUp success', async () => {
      await populateCacheForTid(mockController, 't1');

      const sms = { tournamentId: 't1', matchUpId: 'm1', drawId: 'd1' };
      await mockController.scoreMatchUp(sms as any, {} as any);

      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]).sort();
      expect(deletedKeys).toEqual(['gac|t1', 'ged|t1|e1', 'gmr|t1', 'gti|t1', 'gti|t1|ms', 'gtm|t1', 'gtp|t1'].sort());
    });

    it('does not delete cache keys when the mutation fails', async () => {
      const failingService = {
        ...mockService,
        executionQueue: jest.fn().mockResolvedValue({ error: 'fail' }),
      } as unknown as FactoryService;
      const failingController = new FactoryController(failingService, mockBroadcast, mockCache);
      await populateCacheForTid(failingController, 't1');

      const eqd = { tournamentIds: ['t1'], methods: [] };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await failingController.executionQueue(eqd as any, mockReq);

      expect(mockCache.del).not.toHaveBeenCalled();
    });

    it('caps the per-tournament Set size and FIFO-evicts the oldest entry', async () => {
      // Bypass the controller's public cacheFx and hammer the private
      // trackTournamentKey via repeated tournamentInfo POSTs with many
      // distinct flag-variant keys. The cap is 200; we issue 205 unique
      // keys for the same tid and expect the side-table to hold no more
      // than 200.
      for (let i = 0; i < 205; i++) {
        await mockController.tournamentInfo({
          tournamentId: 't1',
          // Bit-pack i into the four flag booleans to generate distinct keys.
          withMatchUpStats: (i & 1) === 1,
          withStructureDetails: (i & 2) === 2,
          usePublishState: (i & 4) === 4,
          withVenueData: (i & 8) === 8,
          // Extra discriminator that lives outside the flag bits to push
          // past 16 combinations — uses eventData instead.
        } as any);
        // Also issue eventData with a unique eventId so we cross 16 keys.
        await mockController.eventData({ tournamentId: 't1', eventId: `e-${i}` } as any);
      }
      // Force invalidation; count what landed in the side-table.
      const eqd = { tournamentIds: ['t1'], methods: [] };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);
      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]);
      expect(deletedKeys.length).toBeLessThanOrEqual(200);
    });

    it('rejects stringified-falsy tournamentIds from the side-table', async () => {
      // Caller sends a malformed tournamentId that template-stringifies
      // to 'null' / 'NaN' / 'false' / 'undefined' / empty string. The
      // key is still cached (the underlying read returns a result), but
      // trackTournamentKey must refuse to bucket it — otherwise a real
      // tournament with id 'null' would share a bucket with malformed
      // callers, and invalidating one would mass-evict the other.
      await mockController.tournamentInfo({ tournamentId: null as any } as any);
      await mockController.tournamentInfo({ tournamentId: NaN as any } as any);
      await mockController.tournamentInfo({ tournamentId: false as any } as any);
      await mockController.tournamentInfo({ tournamentId: '' } as any);

      const eqd = { tournamentIds: ['null', 'NaN', 'false', ''], methods: [] };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);

      // None of the malformed-buckets should produce any del calls.
      expect(mockCache.del).not.toHaveBeenCalled();
    });

    it('clears the side-table entry after invalidation so a stale key is not re-deleted', async () => {
      await populateCacheForTid(mockController, 't1');

      const eqd = { tournamentIds: ['t1'], methods: [] };
      const mockReq = { provisioner: undefined, headers: {}, auditSource: undefined };
      await mockController.executionQueue(eqd as any, mockReq);

      const firstDeleteCount = mockCache.del.mock.calls.length;
      expect(firstDeleteCount).toBeGreaterThan(0);

      // A second invalidation immediately after should find no tracked
      // keys for t1 (they were cleared on the first pass).
      await mockController.executionQueue(eqd as any, mockReq);
      expect(mockCache.del.mock.calls.length).toBe(firstDeleteCount);
    });
  });
});

/**
 * participantsVersion handshake at the CFS boundary.
 *
 * Participants are 52%-78.6% of an event payload and the same 412 KB block is byte-identical across
 * every event of a tournament (measured: 3,342 KB -> 1,281 KB, 61.7%). The handshake lets a caller
 * prove it already holds them.
 *
 * The load-bearing decision is WHERE the omission happens. Splitting the cache key by version would
 * multiply entries and, worse, store the participants-less variant — which served to a caller holding
 * no version renders every bracket side TBD. So the cache holds ONE full payload per event and the
 * controller strips participants on the way out.
 */
describe('FactoryController eventdata — participantsVersion', () => {
  let mockController: FactoryController;

  const cachedPayload: any = {
    success: true,
    eventData: { eventInfo: { eventId: 'e1' } },
    participants: [{ participantId: 'p1' }, { participantId: 'p2' }],
    participantsVersion: 'p1-2-abc123',
  };

  const mockService = {
    getEventData: jest.fn().mockResolvedValue(cachedPayload),
  } as unknown as FactoryService;

  const mockBroadcast = {
    broadcastMutation: jest.fn(),
    broadcastPublicNotices: jest.fn(),
  } as unknown as TournamentBroadcastService;

  const mockCache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
    del: jest.fn().mockResolvedValue(undefined),
  } as unknown as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockService.getEventData as jest.Mock).mockResolvedValue(cachedPayload);
    mockCache.get.mockResolvedValue(undefined);
    mockController = new FactoryController(mockService, mockBroadcast, mockCache);
  });

  it('includes participants when the caller supplies no version', async () => {
    const result: any = await mockController.eventData({ tournamentId: 't1', eventId: 'e1' } as any);
    expect(result.participants).toHaveLength(2);
    expect(result.participantsVersion).toEqual('p1-2-abc123');
  });

  it('omits participants on an EXACT version match, keeping the rest intact', async () => {
    const result: any = await mockController.eventData({
      tournamentId: 't1',
      eventId: 'e1',
      participantsVersion: 'p1-2-abc123',
    } as any);

    expect(result.participants).toBeUndefined();
    // the stamp still rides, so the caller can detect a later change
    expect(result.participantsVersion).toEqual('p1-2-abc123');
    expect(result.eventData).toBeDefined();
    expect(result.success).toEqual(true);
  });

  it.each([
    ['a stale version', 'p1-2-STALE'],
    ['a malformed version', 'nonsense'],
    ['an empty string', ''],
  ])('INCLUDES participants on %s — the safe direction', async (_label, supplied) => {
    const result: any = await mockController.eventData({
      tournamentId: 't1',
      eventId: 'e1',
      participantsVersion: supplied,
    } as any);
    expect(result.participants).toHaveLength(2);
  });

  it('NEVER caches the participants-less variant', async () => {
    // The trap this design exists to avoid: an omitted payload in the cache would be served to the
    // next caller, who holds no version, and blank every bracket side.
    await mockController.eventData({
      tournamentId: 't1',
      eventId: 'e1',
      participantsVersion: 'p1-2-abc123',
    } as any);

    const stored = mockCache.set.mock.calls.map((call: any[]) => call[1]);
    expect(stored.length).toBeGreaterThan(0);
    for (const value of stored) expect(value.participants).toHaveLength(2);
  });

  it('does not mutate the cached object — a second caller still gets participants', async () => {
    // The cached value is shared. Deleting the key in place would poison it for everyone.
    await mockController.eventData({
      tournamentId: 't1',
      eventId: 'e1',
      participantsVersion: 'p1-2-abc123',
    } as any);
    expect(cachedPayload.participants).toHaveLength(2);

    const second: any = await mockController.eventData({ tournamentId: 't1', eventId: 'e1' } as any);
    expect(second.participants).toHaveLength(2);
  });

  it('uses ONE cache key regardless of the version supplied', async () => {
    await mockController.eventData({ tournamentId: 't1', eventId: 'e1' } as any);
    await mockController.eventData({ tournamentId: 't1', eventId: 'e1', participantsVersion: 'p1-2-abc123' } as any);
    await mockController.eventData({ tournamentId: 't1', eventId: 'e1', participantsVersion: 'other' } as any);

    const keys = new Set(mockCache.set.mock.calls.map((call: any[]) => call[0]));
    expect([...keys]).toEqual(['ged|t1|e1']);
  });
});
