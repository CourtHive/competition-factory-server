import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from 'src/modules/account/auth/decorators/roles.decorator';
import { ConfigReadinessService } from './config-readiness.service';

/**
 * GET  /admin/config/readiness  — return the most recent boot/manual report
 * POST /admin/config/readiness  — re-run the checks (no restart needed)
 *
 * Both are SUPER_ADMIN-gated; the report shape is verbose enough to leak
 * operator-relevant configuration state if exposed to a wider audience.
 */
@Controller('admin/config/readiness')
@Roles([SUPER_ADMIN])
export class ConfigReadinessController {
  constructor(private readonly service: ConfigReadinessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getLatest() {
    return this.service.getLatestReport() ?? this.service.runAndLog('manual');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  reRun() {
    return this.service.runAndLog('manual');
  }
}
