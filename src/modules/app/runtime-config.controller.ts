import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

export interface RuntimeConfig {
  /**
   * Absolute or origin-relative URL where the TMX client app is served.
   * The admin client uses this for the "Impersonate → open in TMX" handoff
   * so the URL is set once on the server and admin-client builds don't have
   * to embed deployment topology at build time.
   */
  tmxUrl: string;
}

/**
 * Public runtime configuration consumed by the admin client and any other
 * front-end that needs to know where sibling apps live. Read once at startup
 * and cached on the client.
 */
@Controller('api/config')
export class RuntimeConfigController {
  @Get()
  @Public()
  getConfig(): RuntimeConfig {
    return {
      tmxUrl: process.env.TMX_URL ?? '/tmx/',
    };
  }
}
