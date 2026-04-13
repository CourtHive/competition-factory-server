import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { AssignmentsService } from './assignments.service';
import { FactoryController } from './factory.controller';
import { StorageModule } from 'src/storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { FactoryService } from './factory.service';
import { AuthModule } from '../auth/auth.module';
import { ConfigService } from '@nestjs/config';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AuthModule, UsersModule, CacheModule, StorageModule, BroadcastModule, AuditModule],
      providers: [FactoryService, AssignmentsService, ConfigService],
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
