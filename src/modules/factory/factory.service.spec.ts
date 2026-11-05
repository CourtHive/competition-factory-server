import { TournamentAuthModule } from '../tournament-auth/tournament-auth.module';
import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { MutationAuthorizationService } from './mutation-authorization.service';
import { ConfigsModule } from 'src/config/config.module';
import { GrantsService } from './grants.service';
import { AssignmentsService } from './assignments.service';
import { FactoryController } from './factory.controller';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { MutationServicesModule } from '../mutation-services/mutation-services.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { StorageModule } from 'src/storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { FactoryService } from './factory.service';
import { ConfigService } from '@nestjs/config';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      // TelemetryModule + MutationServicesModule imported (not stubbed) so the
      // test module mirrors the real provider graph — A1. Telemetry is inert
      // without LOAD_PROFILE_ENABLED.
      imports: [
        TournamentAuthModule,
        ConfigsModule,
        UsersModule,
        CacheModule,
        StorageModule,
        BroadcastModule,
        AuditModule,
        TelemetryModule,
        MutationServicesModule,
      ],
      providers: [
        FactoryService,
        AssignmentsService,
        MutationAuthorizationService,
        GrantsService,
        ConfigService,
        SnapshotProjectionService,
      ],
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
