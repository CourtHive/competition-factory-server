import { Module } from '@nestjs/common';

import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyRegistryHydrator } from './policy-registry-hydrator.service';
import { PolicySeedLoader } from './policy-seed-loader.service';

@Module({
  controllers: [PoliciesController],
  providers: [PoliciesService, PolicySeedLoader, PolicyRegistryHydrator],
  exports: [PoliciesService],
})
export class PoliciesModule {}
