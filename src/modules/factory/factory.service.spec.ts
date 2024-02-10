import { FactoryController } from './factory.controller';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../../auth/auth.module';
import { FactoryService } from './factory.service';
import { ConfigService } from '@nestjs/config';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AuthModule, UsersModule],
      controllers: [FactoryController],
      providers: [FactoryService, ConfigService, { provide: CACHE_MANAGER, useValue: {} }],
    }).compile();
  });

  describe('version', () => {
    it('should return version', () => {
      const factoryController = app.get(FactoryController);
      expect(factoryController.getVersion().version).toBeDefined();
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
