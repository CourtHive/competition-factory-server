import { ConsumerRegistryService } from './consumer-registry.service';
import { ConsumerBootstrap } from './consumer-bootstrap.service';
import { ProjectorService } from './projector.service';
import { Module } from '@nestjs/common';

@Module({
  providers: [ConsumerRegistryService, ConsumerBootstrap, ProjectorService],
  exports: [ConsumerRegistryService, ProjectorService],
})
export class ProjectorsModule {}
