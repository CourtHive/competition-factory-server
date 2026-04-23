import { PublicLiveBroadcaster } from './public-live-broadcaster.service';
import { ConsumerRegistryService } from './consumer-registry.service';
import { ConsumerBootstrap } from './consumer-bootstrap.service';
import { PublicModule } from '../messaging/public/public.module';
import { ProjectorService } from './projector.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [PublicModule],
  providers: [
    ConsumerRegistryService,
    ConsumerBootstrap,
    ProjectorService,
    PublicLiveBroadcaster,
  ],
  exports: [ConsumerRegistryService, ProjectorService],
})
export class ProjectorsModule {}
