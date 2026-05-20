/**
 * CommonJS bridge to factory's policyRegistry.
 *
 * ts-jest's type cache has a stale view of `tods-competition-factory`'s
 * exports after factory rebuilds — it doesn't see `policyRegistry` even
 * when the symlinked d.ts (which `tsc --noEmit` is happy with) contains it.
 * Routing the import through a `require()` call with an explicit type
 * declaration sidesteps that cache.
 *
 * Once `tods-competition-factory` is republished with the policyRegistry
 * export in a fresh dist, this file can be deleted and the consumer
 * imports rewritten to `import { policyRegistry } from
 * 'tods-competition-factory'`.
 */

export interface PolicyRegistryShape {
  register(args: {
    policyType: string;
    name: string;
    version?: string;
    definition: Record<string, any>;
  }): void;
  lookup(args: { policyType: string; name: string; version?: string }): Record<string, any> | undefined;
  list(args?: { policyType?: string }): Array<{
    policyType: string;
    name: string;
    version?: string;
    definition: Record<string, any>;
  }>;
  clear(args?: { policyType?: string; name?: string }): void;
}

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const factory = require('tods-competition-factory') as { policyRegistry: PolicyRegistryShape };

export const policyRegistry: PolicyRegistryShape = factory.policyRegistry;
