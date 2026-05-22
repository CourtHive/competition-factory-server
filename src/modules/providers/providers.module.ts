import { ProviderLifecycleService } from './provider-lifecycle.service';
import { ProviderCleanupService } from './provider-cleanup.service';
import { ProviderArchiveService } from './provider-archive.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { TopologiesService } from './topologies.service';
import { ProviderCatalogService } from './provider-catalog.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    TopologiesService,
    ProviderCatalogService,
    ProviderArchiveService,
    ProviderCleanupService,
    ProviderLifecycleService,
  ],
  exports: [ProvidersService, TopologiesService, ProviderCatalogService],
})
export class ProvidersModule {}
