import { Test, TestingModule } from '@nestjs/testing';
import { UsersModule } from '../users/users.module';
import { CacheModule } from '../cache/cache.module';
import { AppController } from './app.controller';
import { AuthModule } from '../auth/auth.module';
import { AppService } from './app.service';
import { it } from '@jest/globals';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, UsersModule, CacheModule],
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('should be defined', () => {
    expect(appController).toBeDefined();
  });
});
