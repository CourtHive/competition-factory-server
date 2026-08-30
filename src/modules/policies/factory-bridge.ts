/**
 * CommonJS bridge to factory's policyRegistry.
 *
 * Originally written because ts-jest's type cache had a stale view of
 * `tods-competition-factory`'s exports after factory rebuilds — it did not see
 * `policyRegistry` even when the symlinked d.ts (which `tsc --noEmit` is happy
 * with) contained it. Routing the import through a `require()` call with an
 * explicit type declaration sidestepped that cache.
 *
 * ts-jest is gone as of the vitest migration, so that specific motivation no
 * longer applies. The bridge is left in place because removing it is a
 * production-code change that belongs with the republished-factory cleanup
 * below, not with a test-runner swap.
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
