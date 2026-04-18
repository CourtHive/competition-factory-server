import { StorageModule } from 'src/storage/storage.module';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersModule } from '../users/users.module';
import { CacheModule } from '../cache/cache.module';
import { AppController } from './app.controller';
import { AuthModule } from '../auth/auth.module';
import { AppService } from './app.service';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AuthModule, UsersModule, CacheModule, StorageModule],
      controllers: [AppController],
      providers: [AppService],
    }).compile();
  });

  describe('factoryServer', () => {
    it('should be a redirect (void return — NestJS @Redirect handles the response)', () => {
      const appController = app.get(AppController);
      // @Redirect decorator handles the 301; the method body returns void
      expect(appController.factoryServer()).toBeUndefined();
    });
  });
});
