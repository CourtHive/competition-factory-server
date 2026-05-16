import { Controller, Get, Header, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';

import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/role.guard';
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

/**
 * Admin endpoint for hot-reloading the i18n cache from disk.
 *
 * Phase 4 of the i18n delivery migration. This is the minimal first step:
 * an in-process disk re-read, suitable when an operator has already
 * dropped new files into `<cwd>/i18n/` (via SCP, rsync, or Mentat
 * orchestration). The GitHub-release tarball pull described in the
 * plan is a follow-on enhancement.
 */
@Controller('admin/i18n')
@UseGuards(RolesGuard)
export class I18nAdminController {
  constructor(private readonly service: I18nService) {}

  @Post('refresh')
  @Roles([ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async refresh() {
    const previousVersion = this.service.getManifest()?.version ?? null;
    const result = await this.service.loadFromDisk();
    return {
      previousVersion,
      newVersion: result.manifestVersion,
      localesLoaded: result.localesLoaded,
    };
  }
}
