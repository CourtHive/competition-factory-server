import { Global, Module } from '@nestjs/common';

import { AdminLoadProfileController } from './admin-load-profile.controller';
import { CspReportController } from './csp-report.controller';
import { LoadProfileService } from './load-profile.service';

/**
 * Stage 0 of tournament-affinity sharding: per-tournament mutation load
 * telemetry (planning/CFS_TOURNAMENT_AFFINITY_SHARDING.md).
 *
 * Global so `executionQueue` — which is a plain function reached through the
 * FactoryModule services bag rather than through DI — can be handed the
 * recorder without threading a provider import through every caller.
 *
 * Inert unless `LOAD_PROFILE_ENABLED=true`: `record()` returns immediately, no
 * timer is started, and nothing is written. The controller still serves, so an
 * operator can confirm the disabled state rather than having to infer it from
 * an empty table.
 *
 * Also home to the TMX web CSP report endpoint (`/csp-report`), the other client-measurement ingress.
 */
@Global()
@Module({
  controllers: [AdminLoadProfileController, CspReportController],
  providers: [LoadProfileService],
  exports: [LoadProfileService],
})
export class TelemetryModule {}
