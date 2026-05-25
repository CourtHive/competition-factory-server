import { TournamentSyncModule } from '../tournament-sync/tournament-sync.module';
import { FederationDataModule } from '../federation-data/federation-data.module';
import { RankingsWebhookModule } from '../rankings-webhook/rankings-webhook.module';
import { ProvisionerModule } from '../provisioner/provisioner.module';
import { OfficiatingModule } from '../officiating/officiating.module';
import { BoltHistoryModule } from '../bolt-history/bolt-history.module';
import { SanctioningModule } from '../sanctioning/sanctioning.module';
import { PoliciesModule } from '../policies/policies.module';
import { AuditModule } from '../audit/audit.module';
import { isModuleEnabled } from '../../config/server-profile';
import { MessagingModule } from '../messaging/messaging.module';
import { ProvidersModule } from '../providers/providers.module';
import { StorageModule } from '../../storage/storage.module';
import { ConfigsModule } from '../../config/config.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { FactoryModule } from '../factory/factory.module';
import { I18nModule } from '../i18n/i18n.module';
import { RuntimeConfigController } from './runtime-config.controller';
import { AppController } from './app.controller';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { AccountModule } from '../account/account.module';
import { AppService } from './app.service';
import { Module } from '@nestjs/common';
import { join } from 'path';

// Core modules — always loaded regardless of profile
const coreModules = [
  ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'client') }),
  StorageModule,
  ConfigsModule,
  FederationDataModule,
  I18nModule,
  RankingsWebhookModule,
  UsersModule,
  AccountModule,
];

// Tournament modules — loaded for 'tournament' and 'full' profiles
const tournamentModules = isModuleEnabled('tournament')
  ? [FactoryModule, MessagingModule, ProvidersModule, CacheModule, BoltHistoryModule, AuditModule, ProvisionerModule, TournamentSyncModule.forRoot()]
  : [];

// Provider modules — loaded for 'provider' and 'full' profiles
const providerModules = isModuleEnabled('provider')
  ? [SanctioningModule, OfficiatingModule, PoliciesModule]
  : [];

@Module({
  imports: [...coreModules, ...tournamentModules, ...providerModules],
  controllers: [AppController, RuntimeConfigController],
  providers: [AppService],
})
export class AppModule {}
