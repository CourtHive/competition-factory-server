import { MailgunService } from './modules/mail/mailGun.service';
import { UsersModule } from './modules/users/users.module';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AppService } from './app.service';
import { ConfigService } from '@nestjs/config';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AuthModule, UsersModule],
      controllers: [AppController],
      providers: [AppService, MailgunService, ConfigService],
    }).compile();
  });

  describe('getHello', () => {
    it('should return "Factory server"', () => {
      const appController = app.get(AppController);
      expect(appController.factoryService()).toStrictEqual({
        message: 'Factory server',
      });
    });
  });
});
