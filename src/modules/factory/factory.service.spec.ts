import { FactoryController } from './factory.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { FactoryService } from './factory.service';
import { AuthModule } from '../auth/auth.module';
import { ConfigService } from '@nestjs/config';
import { it } from '@jest/globals';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AuthModule, UsersModule, CacheModule],
      providers: [FactoryService, ConfigService],
      controllers: [FactoryController],
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
