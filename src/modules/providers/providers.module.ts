import { AdminProviderKeysController } from './admin-provider-keys.controller';
import { ProviderApiKeyMiddleware } from './provider-api-key.middleware';
import { ProviderLifecycleService } from './provider-lifecycle.service';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ProviderCleanupService } from './provider-cleanup.service';
import { ProviderArchiveService } from './provider-archive.service';
import { ProviderCatalogService } from './provider-catalog.service';
import { ProviderApiKeyService } from './provider-api-key.service';
import { TeamDisplayController } from './team-display.controller';
import { AmsPoliciesClient } from './ams-policies-client.service';
import { ProviderKeyController } from './provider-key.controller';
import { ProvidersController } from './providers.controller';
import { FactoryModule } from '../factory/factory.module';
import { TopologiesService } from './topologies.service';
import { ProvidersService } from './providers.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule, FactoryModule],
  controllers: [ProvidersController, AdminProviderKeysController, ProviderKeyController, TeamDisplayController],
  providers: [
    ProvidersService,
    TopologiesService,
    ProviderCatalogService,
    ProviderArchiveService,
    ProviderCleanupService,
    AmsPoliciesClient,
    ProviderLifecycleService,
    ProviderApiKeyService,
    ProviderApiKeyMiddleware,
  ],
  exports: [ProvidersService, TopologiesService, ProviderCatalogService, ProviderApiKeyService],
})
export class ProvidersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply ProviderApiKeyMiddleware globally — it only acts on `pkey_*`
    // Bearer tokens and passes through otherwise, so coexists with
    // ProvisionerMiddleware (which handles `prov_*` tokens) and with
    // standard JWT auth.
    consumer.apply(ProviderApiKeyMiddleware).forRoutes('*');
  }
}
