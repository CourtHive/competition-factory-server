import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';

import { Public } from '../account/auth/decorators/public.decorator';
import { FONT_ASSET_FILES } from './fonts.catalog';
import { FontsService } from './fonts.service';

const FILES_BASE = '/fonts/files';

/**
 * Public font catalog + binary delivery. Public (no JWT) because fonts are
 * needed before login and by unauthenticated apps (courthive-public). Binaries
 * are immutable, versioned-by-filename assets, so they cache aggressively and
 * stay off the mutation path.
 */
@Public()
@Controller('fonts')
export class FontsController {
  constructor(private readonly service: FontsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  getCatalog() {
    const fonts = this.service.getCatalog().map((font) => ({
      id: font.id,
      label: font.label,
      languages: font.languages,
      builtin: font.builtin ?? false,
      files: font.files
        ? Object.fromEntries(Object.entries(font.files).map(([style, file]) => [style, `${FILES_BASE}/${file}`]))
        : undefined,
    }));
    return { fonts };
  }

  @Get('files/:filename')
  getFontFile(@Param('filename') filename: string, @Res() res: Response) {
    if (!FONT_ASSET_FILES.has(filename)) {
      throw new NotFoundException(`Unknown font file: ${filename}`);
    }
    const buffer = this.service.getFontBuffer(filename);
    if (!buffer) {
      throw new NotFoundException(`Font file not loaded: ${filename}`);
    }
    // Set headers manually: @Res() puts the handler in library mode where Nest
    // does not apply @Header() decorators.
    res.setHeader('Content-Type', 'font/ttf');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }
}
