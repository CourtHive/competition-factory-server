import { InstanceStateMiddleware } from '../factory/engines/instanceState.middleware';
import { TournamentSyncModule } from '../tournament-sync/tournament-sync.module';
import { RankingsProxyModule } from '../rankings-proxy/rankings-proxy.module';
import { RankingsWebhookModule } from '../rankings-webhook/rankings-webhook.module';
import { HttpThrottlerGuard } from '../../common/throttling/http-throttler.guard';
import { ProvisionerModule } from '../provisioner/provisioner.module';
// OfficiatingModule + SanctioningModule retired 2026-05-27 (un-registered) and
// their module dirs + orphaned storage layer removed 2026-06-26: superseded by AMS
// (AMS-WS-07, AMS-WS-08); no consumer in TMX/admin-client/AMS-console calls the
// CFS routes. The trailing Postgres tables (official_records, sanctioning_records)
// were dropped 2026-08-16 in migration 041 — both were empty in prod, so the
// "data migration into courthive_ams" tail closed with nothing to move. Officiating
// and sanctioning state is now AMS-owned outright; CFS reaches sanctioning through
// SanctioningClient over the service token. See
// Mentat/planning/AMS_DEPLOY_AND_RETIREMENT.md §CFS retirement windows #1 + #2.
import { MutationServicesModule } from '../mutation-services/mutation-services.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { PoliciesModule } from '../policies/policies.module';
import { AuditModule } from '../audit/audit.module';
import { ConfigReadinessModule } from '../config-readiness/config-readiness.module';
import { isModuleEnabled } from '../../config/server-profile';
import { MessagingModule } from '../messaging/messaging.module';
import { ProvidersModule } from '../providers/providers.module';
import { StorageModule } from '../../storage/storage.module';
import { ConfigsModule } from '../../config/config.module';
import { FactoryModule } from '../factory/factory.module';
import { I18nModule } from '../i18n/i18n.module';
import { RuntimeConfigController } from './runtime-config.controller';
import { AppController } from './app.controller';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { AccountModule } from '../account/account.module';
import { TournamentAuthModule } from '../tournament-auth/tournament-auth.module';
import { TournamentAdminModule } from '../tournament-admin/tournament-admin.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppService } from './app.service';
import { APP_GUARD } from '@nestjs/core';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ParticipationModule } from '../participation/participation.module';

// Core modules — always loaded regardless of profile.
//
// CFS no longer serves any static SPA. The historical timeline:
//
//   - /admin was retired by WS-17 step #3 (commit f27f168) and replaced
//     by courthive-console at /console/, served by NGINX at the edge from
//     ~/apps/courthive-console/docs/.
//   - /tmx, /tmx-beta, /pub were briefly restored as per-path
//     ServeStaticModule entries by CFS PR #747 after the original WS-17
//     commit accidentally took them down with the broad rootPath block —
//     but that fix-forward kept the wrong shape. As of this commit they
//     too are served by NGINX at the edge from ~/apps/{TMX,tmx-beta,
//     courthive-public}/docs/ respectively, matching the /console/ and
//     /epixodic/ pattern.
//
// CFS is now purely REST + WebSocket. See planning/AMS_DEPLOY_AND_RETIREMENT.md
// §"CFS static-SPA retirement — /tmx, /tmx-beta, /pub" for the cutover
// runbook (NGINX blocks must land on the target host before this commit
// is deployed via mentat-push-server.sh, or those three URLs 404 until
// the flip).

const coreModules = [
  StorageModule,
  ConfigsModule,
  I18nModule,
  RankingsWebhookModule,
  RankingsProxyModule,
  UsersModule,
  // TournamentAuthModule (SPLIT relay-token + hiveid-tournament routes + the
  // global AuthGuard/AuthMiddleware/JWKS verify infra) and TournamentAdminModule
  // (STAY registrations/declarations) are the Phase-3 survivors — CFS keeps them
  // when AccountModule (the MOVE surface) is dropped at the nginx cutover. Loaded
  // BEFORE AccountModule so the global JwtModule + AuthGuard are registered first.
  TournamentAuthModule,
  TournamentAdminModule,
  AccountModule,
  ConfigReadinessModule,
];

// Tournament modules — loaded for 'tournament' and 'full' profiles
const tournamentModules = isModuleEnabled('tournament')
  ? [
      FactoryModule,
      MessagingModule,
      ProvidersModule,
      ParticipationModule,
      CacheModule,
      AuditModule,
      ProvisionerModule,
      // Stage 0 of tournament-affinity sharding — per-tournament mutation load
      // telemetry. Inert unless LOAD_PROFILE_ENABLED=true.
      TelemetryModule,
      // Single builder for the executionQueue services bag. Must load after
      // TelemetryModule (it injects LoadProfileService). Both mutation entry
      // points route through it so the bag cannot diverge per call site again.
      MutationServicesModule,
      TournamentSyncModule.forRoot(),
    ]
  : [];

// Provider modules — loaded for 'provider' and 'full' profiles
const providerModules = isModuleEnabled('provider') ? [PoliciesModule] : [];

// Global HTTP rate limiting: 300 requests / 60s per IP by default. HttpThrottlerGuard
// skips the Socket.IO gateways (live-scoring must not be throttled) and provider/
// provisioner API-key traffic. Tighter per-route limits on auth endpoints
// (login/refresh) via @Throttle are a recommended follow-up.
const throttlerModule = ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]);

@Module({
  imports: [throttlerModule, ...coreModules, ...tournamentModules, ...providerModules],
  controllers: [AppController, RuntimeConfigController],
  providers: [AppService, { provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Establish a factory engine-state store for every HTTP request so no REST handler can
  // touch the engine outside runWithInstanceState (see InstanceStateMiddleware). forRoutes('*')
  // covers current + future endpoints; the Socket.IO path wraps itself in executionQueue.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(InstanceStateMiddleware).forRoutes('*');
  }
}
