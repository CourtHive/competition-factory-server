import { TournamentSyncModule } from '../tournament-sync/tournament-sync.module';
import { FederationDataModule } from '../federation-data/federation-data.module';
import { RankingsProxyModule } from '../rankings-proxy/rankings-proxy.module';
import { RankingsWebhookModule } from '../rankings-webhook/rankings-webhook.module';
import { ProvisionerModule } from '../provisioner/provisioner.module';
import { BoltHistoryModule } from '../bolt-history/bolt-history.module';
// OfficiatingModule + SanctioningModule retired 2026-05-27: superseded by AMS
// (AMS-WS-07, AMS-WS-08); no consumer in TMX/admin-client/AMS-console calls the
// CFS routes. Module directories kept for a follow-up sweep; CFS Postgres
// tables (officiating/sanctioning) retained pending a data migration into
// courthive_ams. See Mentat/planning/AMS_DEPLOY_AND_RETIREMENT.md §CFS
// retirement windows #1 + #2.
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
import { AppService } from './app.service';
import { Module } from '@nestjs/common';

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
  FederationDataModule,
  I18nModule,
  RankingsWebhookModule,
  RankingsProxyModule,
  UsersModule,
  AccountModule,
  ConfigReadinessModule,
];

// Tournament modules — loaded for 'tournament' and 'full' profiles
const tournamentModules = isModuleEnabled('tournament')
  ? [FactoryModule, MessagingModule, ProvidersModule, CacheModule, BoltHistoryModule, AuditModule, ProvisionerModule, TournamentSyncModule.forRoot()]
  : [];

// Provider modules — loaded for 'provider' and 'full' profiles
const providerModules = isModuleEnabled('provider') ? [PoliciesModule] : [];

@Module({
  imports: [...coreModules, ...tournamentModules, ...providerModules],
  controllers: [AppController, RuntimeConfigController],
  providers: [AppService],
})
export class AppModule {}
