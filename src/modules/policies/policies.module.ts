import { Module } from '@nestjs/common';

import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicySeedLoader } from './policy-seed-loader.service';

@Module({
  controllers: [PoliciesController],
  providers: [PoliciesService, PolicySeedLoader],
  exports: [PoliciesService],
})
export class PoliciesModule {}
