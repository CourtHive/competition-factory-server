import { FactoryController } from './factory.controller';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { FactoryService } from './factory.service';
import { ConfigService } from '@nestjs/config';

describe('AppController', () => {
  let factoryController: FactoryController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, UsersModule],
      controllers: [FactoryController],
      providers: [FactoryService, ConfigService, { provide: CACHE_MANAGER, useValue: {} }],
    }).compile();

    factoryController = app.get<FactoryController>(FactoryController);
  });

  it('should be defined', () => {
    expect(factoryController).toBeDefined();
  });
});
