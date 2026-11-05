import { TournamentAuthModule } from '../tournament-auth/tournament-auth.module';
import { StorageModule } from 'src/storage/storage.module';
import { ConfigsModule } from 'src/config/config.module';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersModule } from '../users/users.module';
import { CacheModule } from '../cache/cache.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;
  let appController: AppController;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [TournamentAuthModule, UsersModule, ConfigsModule, CacheModule, StorageModule],
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', () => {
    expect(appController).toBeDefined();
  });
});
