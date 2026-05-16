import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface LocaleManifestEntry {
  code: string;
  label: string;
  nativeLabel: string;
  version: string;
  size: number;
  keyCount: number;
  completeness: number;
  rtl: boolean;
}

export interface Manifest {
  version: string;
  generatedAt: string;
  locales: LocaleManifestEntry[];
}

export interface CachedLocale {
  content: string;
  etag: string;
}

/**
 * Serves locale files for the TMX client.
 *
 * Locale files live on disk under `<cwd>/i18n/` and are populated either:
 *  - At deploy time via `pnpm install` resolving `@courthive/i18n` and a
 *    build script that copies its `dist/locales/*` + `manifest.json` there.
 *  - At runtime via the admin refresh endpoint (Phase 4 of the i18n plan).
 *
 * In-memory cache holds the manifest + each locale content + its sha256 ETag.
 * Warm-load runs on bootstrap; subsequent requests serve from cache with
 * standard HTTP ETag handling at the controller layer.
 */
@Injectable()
export class I18nService implements OnModuleInit {
  private readonly logger = new Logger(I18nService.name);
  private readonly i18nDir = join(process.cwd(), 'i18n');

  private manifest: Manifest | null = null;
  private readonly localeCache = new Map<string, CachedLocale>();

  async onModuleInit(): Promise<void> {
    await this.loadFromDisk();
  }

  /** Re-read manifest + locales from disk. Called on bootstrap and on admin refresh. */
  async loadFromDisk(): Promise<{ localesLoaded: number; manifestVersion: string | null }> {
    this.localeCache.clear();
    this.manifest = null;

    try {
      const manifestPath = join(this.i18nDir, 'manifest.json');
      const manifestRaw = await readFile(manifestPath, 'utf8');
      this.manifest = JSON.parse(manifestRaw) as Manifest;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.logger.warn(`No i18n/manifest.json found at ${this.i18nDir} — i18n endpoints will return empty/404.`);
        return { localesLoaded: 0, manifestVersion: null };
      }
      this.logger.error(`Failed to read i18n/manifest.json: ${err?.message ?? err}`);
      throw err;
    }

    let localesLoaded = 0;
    for (const entry of this.manifest.locales) {
      const localePath = join(this.i18nDir, 'locales', `${entry.code}.json`);
      try {
        const content = await readFile(localePath, 'utf8');
        this.localeCache.set(entry.code, { content, etag: entry.version });
        localesLoaded += 1;
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          this.logger.warn(`Locale ${entry.code} in manifest but file missing at ${localePath}`);
          continue;
        }
        throw err;
      }
    }

    this.logger.log(`i18n loaded: ${localesLoaded} locales from ${this.manifest.version}`);
    return { localesLoaded, manifestVersion: this.manifest.version };
  }

  getManifest(): Manifest | null {
    return this.manifest;
  }

  getLocale(code: string): CachedLocale | undefined {
    return this.localeCache.get(code);
  }

  /** Used in tests to verify the on-disk directory the service is configured to read. */
  getI18nDir(): string {
    return this.i18nDir;
  }

  /** Used by health checks. */
  async getDiskState(): Promise<{ exists: boolean; manifestExists: boolean }> {
    try {
      await stat(this.i18nDir);
    } catch {
      return { exists: false, manifestExists: false };
    }
    try {
      await stat(join(this.i18nDir, 'manifest.json'));
      return { exists: true, manifestExists: true };
    } catch {
      return { exists: true, manifestExists: false };
    }
  }

  /** Lists locale codes present on disk under `locales/`. Used by audit + dev tools. */
  async listLocaleFilesOnDisk(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.i18nDir, 'locales'));
      return entries.filter((e) => e.endsWith('.json')).map((e) => e.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }
}
