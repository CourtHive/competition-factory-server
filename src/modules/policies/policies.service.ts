import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  IPolicyStorage,
  POLICY_STORAGE,
  PolicyRecord,
  PolicyVisibility,
} from 'src/storage/interfaces/policy-storage.interface';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import { UserContext } from '../auth/decorators/user-context.decorator';
import { SavePolicyDto } from './dto/save-policy.dto';
import { policyRegistry } from './factory-bridge';
import { validatePolicyForSave } from './policy-validator';

const PUBLIC_VISIBILITIES: PolicyVisibility[] = ['SHARED_DEMO', 'TEMPLATE_REF'];

export interface PolicyApiShape {
  policyId: string;
  providerId: string | null;
  policyType: string;
  name: string;
  version: string;
  visibility: PolicyVisibility;
  definition: any;
  metadata?: any;
  publishedAt: string;
  publishedBy?: string | null;
}

@Injectable()
export class PoliciesService {
  constructor(@Inject(POLICY_STORAGE) private readonly storage: IPolicyStorage) {}

  async listPublicCatalog(filter: { policyType?: string }): Promise<{ policies: PolicyApiShape[] }> {
    const result = await this.storage.listPolicies({
      providerId: null,
      visibilities: PUBLIC_VISIBILITIES,
      policyType: filter.policyType,
    });
    return { policies: (result.policies ?? []).map(toApi) };
  }

  async listForUser(ctx: UserContext, filter: { policyType?: string }): Promise<{ policies: PolicyApiShape[] }> {
    const providerIds = ctx.providerIds;
    const seen = new Set<string>();
    const policies: PolicyApiShape[] = [];

    for (const providerId of providerIds) {
      const result = await this.storage.listPolicies({
        providerId,
        policyType: filter.policyType,
      });
      pushUnique(policies, seen, result.policies ?? []);
    }

    const publicResult = await this.storage.listPolicies({
      providerId: null,
      visibilities: PUBLIC_VISIBILITIES,
      policyType: filter.policyType,
    });
    pushUnique(policies, seen, publicResult.policies ?? []);

    return { policies };
  }

  async getOne(
    args: { policyType: string; name: string; version?: string },
    ctx?: UserContext,
  ): Promise<PolicyApiShape> {
    const globalResult = await this.storage.getPolicy({
      policyType: args.policyType,
      name: args.name,
      version: args.version,
      providerId: null,
    });

    if (globalResult.policy && PUBLIC_VISIBILITIES.includes(globalResult.policy.visibility)) {
      return toApi(globalResult.policy);
    }

    if (ctx) {
      for (const providerId of ctx.providerIds) {
        const providerResult = await this.storage.getPolicy({
          policyType: args.policyType,
          name: args.name,
          version: args.version,
          providerId,
        });
        if (providerResult.policy) return toApi(providerResult.policy);
      }
    }

    throw new NotFoundException(`Policy not found: ${args.policyType}/${args.name}`);
  }

  async save(input: SavePolicyDto, ctx: UserContext): Promise<{ policy: PolicyApiShape }> {
    const validation = validatePolicyForSave({
      policyType: input.policyType,
      name: input.name,
      version: input.version,
      visibility: input.visibility,
      definition: input.definition,
    });
    if (!validation.ok) {
      throw new ForbiddenException({ message: 'Policy validation failed', errors: validation.errors });
    }

    this.assertCanPublish(input.providerId, input.visibility, ctx);

    const policyId = randomUUID();
    const saveResult = await this.storage.savePolicy({
      policyId,
      providerId: input.providerId,
      policyType: input.policyType,
      name: input.name,
      version: input.version,
      visibility: input.visibility,
      definition: input.definition,
      metadata: input.metadata,
      publishedBy: ctx.userId,
    });
    if (saveResult.error) {
      throw new ForbiddenException(saveResult.error);
    }

    const { policy } = await this.storage.findById(policyId);
    if (!policy) throw new NotFoundException('Saved policy could not be re-read');

    // Keep the embedded factory engine's policyRegistry in sync without
    // requiring a server restart. The hydrator does the initial bulk load
    // at boot; this catches anything POSTed after.
    policyRegistry.register({
      policyType: policy.policyType,
      name: policy.name,
      version: policy.version,
      definition: policy.definition,
    });

    return { policy: toApi(policy) };
  }

  async deleteByPolicyId(policyId: string, ctx: UserContext): Promise<{ success: true }> {
    const { policy } = await this.storage.findById(policyId);
    if (!policy) throw new NotFoundException(`Policy not found: ${policyId}`);

    this.assertCanPublish(policy.providerId, policy.visibility, ctx);
    await this.storage.deletePolicy({ policyId });
    return { success: true };
  }

  private assertCanPublish(providerId: string | null, visibility: PolicyVisibility, ctx: UserContext): void {
    if (ctx.isSuperAdmin) return;

    if (providerId === null) {
      throw new ForbiddenException('Only super-admins can publish or remove global policies');
    }

    if (visibility !== 'PROVIDER_PRIVATE') {
      throw new ForbiddenException(
        'Only super-admins can publish or remove SHARED_DEMO or TEMPLATE_REF policies',
      );
    }

    if (ctx.providerRoles[providerId] !== PROVIDER_ADMIN) {
      throw new ForbiddenException(`Caller is not PROVIDER_ADMIN for ${providerId}`);
    }
  }
}

function pushUnique(target: PolicyApiShape[], seen: Set<string>, records: PolicyRecord[]): void {
  for (const record of records) {
    if (seen.has(record.policyId)) continue;
    seen.add(record.policyId);
    target.push(toApi(record));
  }
}

function toApi(record: PolicyRecord): PolicyApiShape {
  return {
    policyId: record.policyId,
    providerId: record.providerId,
    policyType: record.policyType,
    name: record.name,
    version: record.version,
    visibility: record.visibility,
    definition: record.definition,
    metadata: record.metadata,
    publishedAt: toIso(record.publishedAt),
    publishedBy: record.publishedBy,
  };
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
