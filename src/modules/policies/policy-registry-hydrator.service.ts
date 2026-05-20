import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { IPolicyStorage, POLICY_STORAGE } from 'src/storage/interfaces/policy-storage.interface';
import { policyRegistry } from './factory-bridge';

/**
 * Hydrates the embedded factory engine's policyRegistry from the policies
 * stored in this CFS process at boot.
 *
 * Runs on OnApplicationBootstrap (after every module's OnModuleInit, so
 * PolicySeedLoader has already populated POLICY_STORAGE with file seeds).
 *
 * After hydration, code paths in this process that call
 * `getTournamentPoints({ policyName })` against the embedded factory engine
 * can resolve the policy without an explicit policyDefinitions param.
 *
 * Newly POSTed policies are registered inline by PoliciesService.save, so
 * the registry stays in sync without requiring a server restart.
 */
@Injectable()
export class PolicyRegistryHydrator implements OnApplicationBootstrap {
  private readonly logger = new Logger(PolicyRegistryHydrator.name);

  constructor(@Inject(POLICY_STORAGE) private readonly storage: IPolicyStorage) {}

  async onApplicationBootstrap(): Promise<void> {
    const result = await this.storage.listPolicies({});
    const policies = result.policies ?? [];

    for (const policy of policies) {
      policyRegistry.register({
        policyType: policy.policyType,
        name: policy.name,
        version: policy.version,
        definition: policy.definition,
      });
    }

    this.logger.log(`Hydrated factory engine policyRegistry with ${policies.length} policies`);
  }
}
