import { Module } from '@nestjs/common';
import { PersonsClientModule } from '../persons/persons-client.module';
import { IdentityModule } from '../identity/identity.module';
import { ConfigsModule } from 'src/config/config.module';
import { AuditModule } from '../../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../../users/users.module';
import { HiveIDController } from './hiveid.controller';
import { AuthController } from './auth.controller';
import { HiveIDService } from './hiveid.service';
import { AuthService } from './auth.service';
import { RefreshTokenService } from 'src/services/refresh-token.service';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

// AuthModule — the MOVE session + HiveID-signup surface that lifts out to the IdP.
//
// The verify-only infra (global AuthGuard, AuthMiddleware, JWKS) and the SPLIT
// relay-token service (TrackerTokenService + SplitTokenSigner) moved to
// TournamentAuthModule (the survivor) so this module can be dropped WHOLESALE at
// the nginx cutover. The global AuthGuard + AuthMiddleware this module's own
// routes rely on are provided app-wide by TournamentAuthModule.
//
// The global JwtModule stays registered HERE for now: dropping it broke specs
// that import AccountModule standalone (IdentityService needs JwtService), and a
// second global registration in TournamentAuthModule risks a duplicate-provider
// clash. TournamentAuthModule relies on this global registration in coexistence.
// ⚠ DROP-STEP: when AccountModule is removed at the nginx cutover, MOVE this
// JwtModule.register block into TournamentAuthModule (ACCOUNT_MOVE_PHASE3_EXECUTION_PLAN.md §C/§D).

function isValidJwtExpiresIn(val: string): boolean {
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
    JwtModule.register({ signOptions: { expiresIn }, secret: process.env.JWT_SECRET, global: true }),
  ],
  providers: [AuthService, HiveIDService, RefreshTokenService, ConfigService],
  controllers: [AuthController, HiveIDController],
  exports: [AuthService, HiveIDService, RefreshTokenService],
})
export class AuthModule {}
