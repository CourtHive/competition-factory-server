import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { FONT_CATALOG, FontCatalogEntry } from './fonts.catalog';

/**
 * Loads the catalog's TrueType binaries into memory at startup so the controller
 * can serve them without per-request disk IO. Assets are copied next to the
 * compiled module by nest-cli (`assets` in nest-cli.json), so `__dirname/assets`
 * resolves in both dev and the built output — the same idiom the email
 * templates use (`account/email/render.ts`).
 */
@Injectable()
export class FontsService {
  private readonly logger = new Logger(FontsService.name);
  private readonly buffers = new Map<string, Buffer>();

  constructor() {
    this.loadFonts();
  }

  private loadFonts(): void {
    const dir = join(__dirname, 'assets');
    for (const entry of FONT_CATALOG) {
      if (!entry.files) continue;
      for (const filename of Object.values(entry.files)) {
        if (!filename) continue;
        const path = join(dir, filename);
        if (existsSync(path)) {
          this.buffers.set(filename, readFileSync(path));
        } else {
          this.logger.warn(`Font asset missing: ${path}`);
        }
      }
    }
  }

  getCatalog(): FontCatalogEntry[] {
    return FONT_CATALOG;
  }

  getFontBuffer(filename: string): Buffer | undefined {
    return this.buffers.get(filename);
  }
}
