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
 * These used to live in account/auth's AuthModule. Moving them here is what makes
 * the eventual `AccountModule` drop a safe removal — the verify infra + SPLIT
 * surface no longer hang off the MOVE tree.
 *
 * The AuthGuard, AuthMiddleware, and decorators physically remain in account/auth/
 * as documented boundary exceptions (shared verify infra, like role.guard /
 * socket.guard / buildUserContext); their physical relocation is Phase-4 cleanup.
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

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

// ⚠ DROP-STEP: the global JwtModule this module's AuthGuard / AuthMiddleware /
// TrackerTokenService rely on is registered by AuthModule (the MOVE module) and
// available app-wide in coexistence. When AccountModule/AuthModule are dropped at
// the nginx cutover, ADD the JwtModule.register({ global: true, secret,
// signOptions }) block here so this survivor stays self-sufficient
// (ACCOUNT_MOVE_PHASE3_EXECUTION_PLAN.md §C/§D).
@Module({
  imports: [UsersModule, AuditModule],
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
