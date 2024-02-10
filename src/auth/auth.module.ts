import { UsersModule } from '../modules/users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { AuthService } from './auth.service';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { MailgunService } from 'src/modules/mail/mailGun.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      signOptions: { expiresIn: process.env.JWT_VALIDITY ?? '1d' },
      secret: process.env.JWT_SECRET,
      global: true,
    }),
  ],
  providers: [
    AuthService,
    MailgunService,
    ConfigService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
