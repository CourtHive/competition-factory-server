import { FactoryController } from './factory.controller';
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
      imports: [AuthModule, UsersModule, ConfigsModule, CacheModule],
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

  it('can get tournamentInfo', async () => {
    const result = await factoryController.tournamentInfo({ tournamentId: TEST });
    expect(result.success).toEqual(true);
  });

  it('can get tournamentInfo', async () => {
    const result: any = await factoryController.fetchTournamentRecords({ tournamentId: TEST });
    expect(result.success).toEqual(true);
  });

  it('can generate a tournamentRecord and query for it', async () => {
    const result = await factoryController.generateTournamentRecord({ tournamentAttributes: { tournamentId: TEST } });
    expect(result.tournamentRecord.tournamentId).toBe(TEST);
  });
});
