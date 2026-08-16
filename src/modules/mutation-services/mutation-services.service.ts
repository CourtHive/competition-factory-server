import { Inject, Injectable } from '@nestjs/common';

import { PROJECTION_OUTBOX_STORAGE, type IProjectionOutboxStorage } from 'src/storage/interfaces';
import { LoadProfileService } from '../telemetry/load-profile.service';

/**
 * Keys of the `executionQueue` services bag that are REQUEST-SCOPED — supplied
 * by the caller because they cannot be resolved from DI alone, and legitimately
 * absent on some paths.
 *
 * `cacheManager` and `trackCacheKey` are here because the HTTP path maintains a
 * per-request cache-key side-table that the WebSocket path has no equivalent
 * for. Everything NOT in this list is server-owned and must be supplied by
 * `build()` on every path — that split is what `mutation-services.guard.spec.ts`
 * enforces.
 */
export const REQUEST_SCOPED_SERVICE_KEYS = ['cacheManager', 'trackCacheKey'] as const;

/**
 * Single source of truth for the server-owned half of the `executionQueue`
 * services bag.
 *
 * WHY THIS EXISTS: the bag used to be assembled independently at each call
 * site, and it silently diverged. `tmx.gateway.ts` passed
 * `{ cacheManager, projectionOutbox }` while `factory.controller.ts` passed
 * `{ cacheManager, trackCacheKey }` — so every mutation arriving over REST
 * (including the provisioner API) skipped the read-model projection outbox
 * entirely and produced no deltas. Nothing failed, nothing logged; the read
 * model simply did not learn about those mutations.
 *
 * That is a per-callsite-construction failure mode, not a one-line bug, so the
 * fix is structural: there is now exactly one place that decides what the
 * server contributes to the bag, and a guard spec that fails when a new
 * `services?.x` read appears in executionQueue without being wired here.
 */
@Injectable()
export class MutationServicesService {
  constructor(
    @Inject(PROJECTION_OUTBOX_STORAGE) private readonly projectionOutbox: IProjectionOutboxStorage,
    private readonly loadProfile: LoadProfileService,
  ) {}

  /**
   * Assemble the services bag. `requestScoped` carries only the keys listed in
   * REQUEST_SCOPED_SERVICE_KEYS; everything else is server-owned and added here
   * so no call site can omit it.
   */
  build(requestScoped: { cacheManager?: any; trackCacheKey?: (key: string) => void } = {}) {
    return {
      projectionOutbox: this.projectionOutbox,
      loadProfile: this.loadProfile,
      ...requestScoped,
    };
  }
}
