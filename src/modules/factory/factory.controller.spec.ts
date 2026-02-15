import { FactoryController } from './factory.controller';
import { StorageModule } from 'src/storage/storage.module';
import { ConfigsModule } from 'src/config/config.module';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { FactoryService } from './factory.service';
import { AuthModule } from '../auth/auth.module';
import { TEST } from 'src/common/constants/test';
import { ConfigService } from '@nestjs/config';

describe('FactoryController', () => {
  let factoryController: FactoryController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, UsersModule, ConfigsModule, CacheModule, StorageModule],
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
    const result = await factoryController.generateTournamentRecord({ tournamentId: TEST });
    expect(result.success).toEqual(true);
  });

  it('cannot fetch tournamentRecords without login', async () => {
    const result: any = await factoryController.fetchTournamentRecords({ tournamentId: TEST });
    expect(result.error).toBeDefined();
  });

  it('can generate a tournamentRecord and query for it', async () => {
    const result = await factoryController.generateTournamentRecord({ tournamentAttributes: { tournamentId: TEST } });
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

    const mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    } as unknown as any;

    beforeEach(() => {
      mockController = new FactoryController(mockService, mockCache);
      jest.clearAllMocks();
    });

    it('getTournamentInfo preserves service binding', async () => {
      const result = await mockController.getTournamentInfo('tid');
      expect(mockService.getTournamentInfo).toHaveBeenCalledWith({ tournamentId: 'tid' });
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
});
