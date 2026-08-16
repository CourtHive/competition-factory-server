import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';

import { RolesGuard } from '../account/auth/guards/role.guard';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { LoadProfileService } from './load-profile.service';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { SUPER_ADMIN } from 'src/common/constants/roles';

/**
 * Super-admin read surface over `tournament_load_profile` (migration 043).
 *
 * Read-only by design — this is the measurement half of Stage 0 in
 * planning/CFS_TOURNAMENT_AFFINITY_SHARDING.md. It exists to answer three
 * questions with data instead of inference, before anything is built on top of
 * them:
 *
 *   - Where does the mutation path actually spend its time? (`/hot`)
 *   - How is load distributed across lifecycle classes, i.e. how would affinity
 *     pools need to be sized? (`/classes`)
 *   - Are the lifecycle dates on real records trustworthy enough to route on?
 *     (`/classes` — an `archive` row carrying live mutation traffic is the
 *     contradiction that would misroute a live event.)
 */
@Controller('admin/load-profile')
@UseGuards(RolesGuard)
@Roles([SUPER_ADMIN])
export class AdminLoadProfileController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly loadProfile: LoadProfileService,
  ) {}

  /** Buffer + flush health. Inspectable without a restart, per A4. */
  @Get('status')
  status() {
    return { success: true, ...this.loadProfile.getStatus() };
  }

  /**
   * Heaviest tournaments over a trailing window. Ordered by total elapsed time
   * — the quantity that actually competes for the single-threaded event loop —
   * with the maxima alongside, because the tail is what causes head-of-line
   * blocking and a mean hides it.
   */
  @Get('hot')
  async hot(@Query('hours') hours?: string, @Query('limit') limit?: string) {
    const windowHours = clamp(Number(hours) || 24, 1, 24 * 30);
    const rowLimit = clamp(Number(limit) || 25, 1, 500);

    const result = await this.pool.query(
      `SELECT tournament_id,
              lifecycle_class,
              SUM(mutation_count)     AS mutations,
              SUM(method_count)       AS methods,
              SUM(total_elapsed_ms)   AS total_elapsed_ms,
              MAX(max_elapsed_ms)     AS max_elapsed_ms,
              ROUND(SUM(total_elapsed_ms)::numeric / NULLIF(SUM(mutation_count), 0), 2) AS mean_elapsed_ms,
              MAX(max_record_bytes)   AS max_record_bytes,
              SUM(fenced_count)       AS fenced
         FROM tournament_load_profile
        WHERE bucket_start >= NOW() - ($1 || ' hours')::interval
     GROUP BY tournament_id, lifecycle_class
     ORDER BY total_elapsed_ms DESC
        LIMIT $2`,
      [windowHours, rowLimit],
    );

    return { success: true, windowHours, tournaments: result.rows };
  }

  /**
   * Load rolled up by lifecycle class — the pool-sizing view, and the one that
   * falsifies the routing assumption. `distinct_tournaments` against
   * `mutations` is the tell: the archive class should hold the overwhelming
   * majority of tournaments and a negligible share of mutations. If it does
   * not, the dates are not trustworthy enough to route on.
   */
  @Get('classes')
  async classes(@Query('hours') hours?: string) {
    const windowHours = clamp(Number(hours) || 24, 1, 24 * 30);

    const result = await this.pool.query(
      `SELECT lifecycle_class,
              COUNT(DISTINCT tournament_id) AS distinct_tournaments,
              SUM(mutation_count)   AS mutations,
              SUM(total_elapsed_ms) AS total_elapsed_ms,
              MAX(max_elapsed_ms)   AS max_elapsed_ms,
              MAX(max_record_bytes) AS max_record_bytes
         FROM tournament_load_profile
        WHERE bucket_start >= NOW() - ($1 || ' hours')::interval
     GROUP BY lifecycle_class
     ORDER BY total_elapsed_ms DESC`,
      [windowHours],
    );

    return { success: true, windowHours, classes: result.rows };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
