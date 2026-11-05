import { TournamentAuthModule } from '../tournament-auth/tournament-auth.module';
import { StorageModule } from 'src/storage/storage.module';
import { ConfigsModule } from 'src/config/config.module';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersModule } from '../users/users.module';
import { CacheModule } from '../cache/cache.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [TournamentAuthModule, UsersModule, ConfigsModule, CacheModule, StorageModule],
      controllers: [AppController],
      providers: [AppService],
    }).compile();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('factoryServer', () => {
    it('should be a redirect (void return — NestJS @Redirect handles the response)', () => {
      const appController = app.get(AppController);
      // @Redirect decorator handles the 301; the method body returns void
      expect(appController.factoryServer()).toBeUndefined();
    });
  });
});
