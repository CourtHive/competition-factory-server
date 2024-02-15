import { FactoryController } from './factory.controller';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { FactoryService } from './factory.service';
import { TEST } from 'src/common/constants/test';
import { ConfigService } from '@nestjs/config';
import { ConfigsModule } from 'src/config/config.module';

describe('FactoryController', () => {
  let factoryController: FactoryController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      providers: [FactoryService, ConfigService, { provide: CACHE_MANAGER, useValue: {} }],
      imports: [AuthModule, UsersModule, ConfigsModule],
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

  it('can generate a tournamentRecord and query for it', async () => {
    const result = await factoryController.generateTournamentRecord({ tournamentAttributes: { tournamentId: TEST } });
    expect(result.tournamentRecord.tournamentId).toBe(TEST);
  });
});
