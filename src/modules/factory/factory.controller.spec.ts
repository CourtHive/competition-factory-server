import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { AssignmentsService } from './assignments.service';
import { FactoryController } from './factory.controller';
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
      imports: [AuthModule, UsersModule, ConfigsModule, CacheModule, StorageModule, BroadcastModule, AuditModule],
      providers: [FactoryService, AssignmentsService, ConfigService],
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
      await mockController.scoreMatchUp(sms as any);

      expect(mockBroadcast.broadcastMutation).toHaveBeenCalledWith(
        expect.objectContaining({ tournamentIds: ['t1'] }),
      );
      expect(mockBroadcast.broadcastPublicNotices).toHaveBeenCalled();
    });

    it('does not broadcast after failed score', async () => {
      const mockService = {
        score: jest.fn().mockResolvedValue({ error: 'invalid score' }),
      } as unknown as FactoryService;
      mockController = new FactoryController(mockService, mockBroadcast, mockCache);

      const sms = { tournamentId: 't1', matchUpId: 'm1', drawId: 'd1' };
      await mockController.scoreMatchUp(sms as any);

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
      expect(deletedKeys).toEqual(
        ['gac|t1', 'ged|t1|e1', 'gmr|t1', 'gti|t1', 'gti|t1|ms', 'gtm|t1', 'gtp|t1'].sort(),
      );
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

    it('deletes tracked keys on scoreMatchUp success', async () => {
      await populateCacheForTid(mockController, 't1');

      const sms = { tournamentId: 't1', matchUpId: 'm1', drawId: 'd1' };
      await mockController.scoreMatchUp(sms as any);

      const deletedKeys = mockCache.del.mock.calls.map((c: any[]) => c[0]).sort();
      expect(deletedKeys).toEqual(
        ['gac|t1', 'ged|t1|e1', 'gmr|t1', 'gti|t1', 'gti|t1|ms', 'gtm|t1', 'gtp|t1'].sort(),
      );
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
