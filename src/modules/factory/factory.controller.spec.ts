import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { FactoryController } from './factory.controller';
import { StorageModule } from 'src/storage/storage.module';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigsModule } from 'src/config/config.module';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { FactoryService } from './factory.service';
import { AuthModule } from '../auth/auth.module';
import { TEST } from 'src/common/constants/test';
import { ConfigService } from '@nestjs/config';

const testUser = { providerId: 'test-provider', roles: ['superadmin'] };

describe('FactoryController', () => {
  let factoryController: FactoryController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, UsersModule, ConfigsModule, CacheModule, StorageModule, BroadcastModule],
      providers: [FactoryService, ConfigService],
      controllers: [FactoryController],
    }).compile();

    factoryController = app.get<FactoryController>(FactoryController);
  });

  it('should be defined', () => {
    expect(factoryController).toBeDefined();
  });

  it('can get version', () => {
    expect(factoryController.getVersion()).toBeDefined();
  });

  it('can generate a tournament record', async () => {
    const result = await factoryController.generateTournamentRecord({ tournamentId: TEST }, testUser);
    expect(result.success).toEqual(true);
  });

  it('cannot fetch tournamentRecords without login', async () => {
    const result: any = await factoryController.fetchTournamentRecords({ tournamentId: TEST });
    expect(result.error).toBeDefined();
  });

  it('can generate a tournamentRecord and query for it', async () => {
    const result = await factoryController.generateTournamentRecord({ tournamentAttributes: { tournamentId: TEST } }, testUser);
    expect(result.tournamentRecord.tournamentId).toBe(TEST);
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
      await mockController.executionQueue(eqd as any);

      expect(mockBroadcast.broadcastMutation).toHaveBeenCalledWith(eqd);
      expect(mockBroadcast.broadcastPublicNotices).toHaveBeenCalledWith(eqd, publicNotices);
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
      await mockController.executionQueue(eqd as any);

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
});
