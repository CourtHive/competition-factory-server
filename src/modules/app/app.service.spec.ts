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
      imports: [AuthModule, UsersModule, CacheModule],
      controllers: [AppController],
      providers: [AppService],
    }).compile();
  });

  describe('factoryServer', () => {
    it('should return "Factory server"', () => {
      const appController = app.get(AppController);
      expect(appController.factoryServer()).toStrictEqual({
        message: 'Factory server',
      });
    });
  });
});
