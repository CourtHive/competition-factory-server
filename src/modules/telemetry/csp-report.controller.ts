import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../account/auth/decorators/public.decorator';
import { formatCspViolation, parseCspReports } from './cspReport';

/** A page with a broken policy can fire a report per element; one client gets a bounded share of the log. */
const CSP_REPORT_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * The collection end of the TMX web CSP, which ships report-only (TMX `csp.policy.mjs`). Browsers POST
 * here without credentials, so the route is public; the body is parsed by the small `/csp-report`
 * parser in main.ts (64 KB), which also accepts the two report content types. Each violation becomes
 * one `CspReport` log line; nothing is stored. Always 204: a report endpoint that errors makes the
 * browser retry, and the browser has nothing it could do about a 4xx.
 */
@Controller('csp-report')
export class CspReportController {
  private readonly logger = new Logger('CspReport');

  @Post()
  @Public()
  @Throttle(CSP_REPORT_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  receive(@Body() body: unknown): void {
    for (const violation of parseCspReports(body)) this.logger.warn(formatCspViolation(violation));
  }
}
