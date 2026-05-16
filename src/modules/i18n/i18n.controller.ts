import { Controller, Get, Header, Headers, HttpStatus, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';

import { I18nService } from './i18n.service';

@Controller('i18n')
export class I18nController {
  constructor(private readonly service: I18nService) {}

  @Get('manifest')
  @Header('Cache-Control', 'public, max-age=300')
  getManifest() {
    const manifest = this.service.getManifest();
    if (!manifest) {
      throw new NotFoundException('i18n manifest not loaded');
    }
    return manifest;
  }

  @Get('locales/:code')
  @Header('Cache-Control', 'public, max-age=86400, must-revalidate')
  getLocale(@Param('code') code: string, @Headers('if-none-match') ifNoneMatch: string | undefined, @Res() res: Response) {
    const cached = this.service.getLocale(code);
    if (!cached) {
      throw new NotFoundException(`locale '${code}' not loaded`);
    }

    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      res.setHeader('ETag', cached.etag);
      res.end();
      return;
    }

    res.status(HttpStatus.OK);
    res.setHeader('ETag', cached.etag);
    res.setHeader('Content-Type', 'application/json');
    res.send(cached.content);
  }
}
