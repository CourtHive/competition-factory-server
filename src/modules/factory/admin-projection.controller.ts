import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { ProjectionRebuildService } from './projection/projection-rebuild.service';

/**
 * Super-admin surface for the read-model REBUILD / backfill pipeline. Replaces the
 * ad-hoc `/tmp/backfill-projection.js` that both prod backfills were run from —
 * governed (SUPER_ADMIN only), reproducible, and reboot-safe. Delegates to
 * ProjectionRebuildService, which loads records, projects them through the SAME
 * `buildProjectionDeltas` the incremental producers use, and enqueues to the
 * outbox off the mutation/request hot path in bounded batches.
 *
 * NOTE: `rebuildAll` over the full corpus is a heavy offline job — call it with an
 * explicit `batchSize` and off-peak. Single-tournament rebuild is the targeted
 * re-sync after a data fix.
 */
@Controller('admin/projection')
@UseGuards(RolesGuard)
@Roles([SUPER_ADMIN])
export class AdminProjectionController {
  constructor(private readonly rebuild: ProjectionRebuildService) {}

  // Rebuild many (default: all) tournaments. Body optional: { tournamentIds?, batchSize? }.
  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  async rebuildAll(@Body() body?: { tournamentIds?: string[]; batchSize?: number }) {
    const result = await this.rebuild.rebuildAll(body ?? {});
    return { success: true, ...result };
  }

  // Rebuild a single tournament — targeted re-sync after a data fix.
  @Post('rebuild/:tournamentId')
  @HttpCode(HttpStatus.OK)
  async rebuildOne(@Param('tournamentId') tournamentId: string) {
    const deltas = await this.rebuild.rebuildTournament(tournamentId);
    return { success: true, tournamentId, deltas };
  }
}
