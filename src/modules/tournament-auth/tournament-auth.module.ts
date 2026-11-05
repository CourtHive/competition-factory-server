/**
 * TournamentAuthModule — the SURVIVOR module for the Phase-3 account move.
 *
 * Owns everything CFS must keep once `/auth/*` flips to the HiveID IdP and the
 * MOVE AccountModule is dropped:
 *   - the SPLIT relay-token mints (TournamentTokenController + TrackerTokenService
 *     + SplitTokenSigner) and the SPLIT HiveID tournament routes
 *     (HiveIDTournamentController + HiveIDTournamentService);
 *   - the verify-only infra the whole app depends on: the global AuthGuard, the
 *     JWT-verifying AuthMiddleware (now MOVE-independent — it uses the neutral
 *     verifyJwt), and the JWKS controller (`/.well-known/jwks.json` stays on CFS);
 *   - the global JwtModule registration (verify + local SPLIT signing).
 *
 * These used to live in account/auth's AuthModule, which was dropped with the rest
 * of the MOVE tree once `/auth/*` and `/account/*` were served by the IdP.
 *
 * The AuthGuard, AuthMiddleware, and decorators physically remain in account/auth/
 * as documented boundary exceptions (shared verify infra, like role.guard /
 * socket.guard / buildUserContext); their physical relocation is Phase-4 cleanup.
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { SplitTokenSigner } from 'src/services/split-token-signer.service';
import { HiveIDTournamentController } from './hiveid-tournament.controller';
import { TournamentTokenController } from './tournament-token.controller';
import { HiveIDTournamentService } from './hiveid-tournament.service';
import { AuthMiddleware } from 'src/modules/account/auth/auth.middleware';
import { TrackerTokenService } from './tracker-token.service';
import { AuthGuard } from 'src/modules/account/auth/guards/auth.guard';
import { JwksController } from './jwks.controller';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

function isValidJwtExpiresIn(val: string): boolean {
  return /^(\d+|(\d+)([smhdwMy]))$/.test(val);
}

const rawValidity = process.env.JWT_VALIDITY;
const expiresIn: any = rawValidity && isValidJwtExpiresIn(rawValidity) ? rawValidity : '1d';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    // Global: the AuthGuard, AuthMiddleware and socket guard verify with it, and the SPLIT token routes sign with it.
    JwtModule.register({ signOptions: { expiresIn }, secret: process.env.JWT_SECRET, global: true }),
  ],
  controllers: [TournamentTokenController, HiveIDTournamentController, JwksController],
  providers: [
    TrackerTokenService,
    HiveIDTournamentService,
    SplitTokenSigner,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class TournamentAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
