import { ProviderLifecycleService } from './provider-lifecycle.service';
import { ProviderCleanupService } from './provider-cleanup.service';
import { ProviderArchiveService } from './provider-archive.service';
import { ProviderApiKeyService } from './provider-api-key.service';
import { ProviderApiKeyMiddleware } from './provider-api-key.middleware';
import { ProvidersController } from './providers.controller';
import { AdminProviderKeysController } from './admin-provider-keys.controller';
import { ProviderKeyController } from './provider-key.controller';
import { ProvidersService } from './providers.service';
import { TopologiesService } from './topologies.service';
import { ProviderCatalogService } from './provider-catalog.service';
import { AuditModule } from '../audit/audit.module';
import { FactoryModule } from '../factory/factory.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

@Module({
  imports: [AuditModule, FactoryModule],
  controllers: [ProvidersController, AdminProviderKeysController, ProviderKeyController],
  providers: [
    ProvidersService,
    TopologiesService,
    ProviderCatalogService,
    ProviderArchiveService,
    ProviderCleanupService,
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
