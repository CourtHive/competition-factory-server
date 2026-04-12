import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CloudIngestDto } from './dto/cloud-ingest.dto';
import { RelayConfig } from './relay.config';

@Controller('api/cloud-ingest')
export class CloudIngestController {
  private readonly logger = new Logger(CloudIngestController.name);

  constructor(private readonly config: RelayConfig) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  ingest(
    @Body() body: CloudIngestDto,
    @Headers('authorization') authHeader: string | undefined,
  ): { success: boolean; received: number } {
    if (!body?.venueId) throw new UnauthorizedException('venueId required');
    const expectedKey = this.config.venueApiKeys.get(body.venueId);
    if (!expectedKey) throw new UnauthorizedException(`unknown venue ${body.venueId}`);

    const provided = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (provided !== expectedKey) throw new UnauthorizedException('invalid api key');

    const received = body.entries?.length ?? 0;
    this.logger.log(`cloud-ingest: ${received} entries from ${body.venueId}`);
    // Future: dispatch to public WS fan-out + cloud Postgres replica.
    return { success: true, received };
  }
}
