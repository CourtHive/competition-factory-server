import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PersonsClientModule } from '../persons/persons-client.module';
import { IdentityModule } from '../identity/identity.module';
import { ConfigsModule } from 'src/config/config.module';
import { AuditModule } from '../../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../../users/users.module';
import { HiveIDController } from './hiveid.controller';
import { AuthController } from './auth.controller';
import { HiveIDService } from './hiveid.service';
import { AuthMiddleware } from './auth.middleware';
import { AuthGuard } from './guards/auth.guard';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

function isValidJwtExpiresIn(val: string): boolean {
  // Only allow numbers or numbers with single unit: s, m, h, d, w, M, y
  return /^(\d+|(\d+)([smhdwMy]))$/.test(val);
}

const rawValidity = process.env.JWT_VALIDITY;
const expiresIn: any = rawValidity && isValidJwtExpiresIn(rawValidity) ? rawValidity : '1d';

@Module({
  imports: [
    ConfigsModule,
    UsersModule,
    EmailModule,
    IdentityModule,
    AuditModule,
    PersonsClientModule,
    JwtModule.register({
      signOptions: { expiresIn },
      secret: process.env.JWT_SECRET,
      global: true,
    }),
  ],
  providers: [
    AuthService,
    HiveIDService,
    RefreshTokenService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    ConfigService,
  ],
  controllers: [AuthController, HiveIDController],
  exports: [AuthService, HiveIDService, RefreshTokenService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
