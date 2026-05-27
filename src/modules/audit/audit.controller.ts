import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from '../account/auth/decorators/roles.decorator';
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
}
