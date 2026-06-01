import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { User } from '../account/auth/decorators/user.decorator';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Get the audit trail for a specific tournament.
   * Super-admin only.
   */
  @Post('tournament')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getAuditTrail(@Body() body: { tournamentId: string; from?: string; to?: string; limit?: number }) {
    return this.auditService.getAuditTrail(body);
  }

  /**
   * Get audit rows for deleted tournaments.
   * Super-admin only.
   */
  @Post('deleted')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getDeletedTournaments(@Body() body: { from?: string; to?: string; limit?: number }) {
    return this.auditService.getDeletedTournaments(body);
  }

  /**
   * Get every audit row written by a specific actor (provisioner,
   * provider, user, or service). Bounds a principal's blast radius and
   * exercises the migration-036 partial index `idx_audit_log_actor`.
   * Super-admin only.
   */
  @Post('actor')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getByActor(
    @Body()
    body: {
      actorType: 'user' | 'provisioner' | 'provider' | 'service';
      actorId: string;
      from?: string;
      to?: string;
      limit?: number;
    },
  ) {
    return this.auditService.getByActor(body);
  }

  /**
   * Get audit rows for deleted draw definitions. Each row's
   * metadata.deletedDrawSnapshot contains the full drawDefinition body so the
   * deletion is recoverable. Super-admin only.
   */
  @Post('deleted-draws')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getDeletedDraws(
    @Body() body: { tournamentId?: string; eventId?: string; from?: string; to?: string; limit?: number },
  ) {
    return this.auditService.getDeletedDraws(body);
  }

  /**
   * Restore a deleted drawDefinition from its audit snapshot.
   * Idempotent: refuses if the audit row has already been restored, and the
   * factory's `addDrawDefinition` itself refuses if the draw is currently
   * present on the tournament.
   * Super-admin only.
   */
  @Post('restore-draw')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  restoreDraw(
    @Body() body: { auditId: string },
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    // Postgres `user_id UUID` rejects empty strings; coerce to undefined so
    // the storage layer writes NULL when the request has no resolved user.
    const userId = userContext?.userId || user?.userId || undefined;
    return this.auditService.restoreDraw({
      auditId: body?.auditId,
      userId,
      userEmail: user?.email,
    });
  }
}
