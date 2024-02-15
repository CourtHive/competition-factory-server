import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { AuthService } from './auth.service';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigsModule } from 'src/config/config.module';

@Module({
  imports: [
    ConfigsModule,
    UsersModule,
    JwtModule.register({
      signOptions: { expiresIn: process.env.JWT_VALIDITY ?? '1d' },
      secret: process.env.JWT_SECRET,
      global: true,
    }),
  ],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    ConfigService,
    { provide: CACHE_MANAGER, useValue: {} },
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
