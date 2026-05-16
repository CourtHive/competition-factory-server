import { Test } from '@nestjs/testing';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { I18nService } from './i18n.service';

describe('I18nService', () => {
  let originalCwd: string;
  let tempDir: string;
  let service: I18nService;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = join('/tmp', `i18n-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(tempDir, 'i18n', 'locales'), { recursive: true });
    process.chdir(tempDir);

    const mod = await Test.createTestingModule({ providers: [I18nService] }).compile();
    service = mod.get(I18nService);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null manifest + empty cache when i18n/manifest.json is absent', async () => {
    await service.onModuleInit();
    expect(service.getManifest()).toBeNull();
    expect(service.getLocale('en')).toBeUndefined();
  });

  it('loads manifest and locales from disk', async () => {
    const manifest = {
      version: '@courthive/i18n@0.1.0',
      generatedAt: '2026-05-16T18:00:00Z',
      locales: [
        {
          code: 'en',
          label: 'English',
          nativeLabel: 'English',
          version: 'sha256-en-version',
          size: 100,
          keyCount: 10,
          completeness: 1.0,
          rtl: false,
        },
        {
          code: 'fr',
          label: 'French',
          nativeLabel: 'Français',
          version: 'sha256-fr-version',
          size: 110,
          keyCount: 10,
          completeness: 1.0,
          rtl: false,
        },
      ],
    };
    await writeFile(join(tempDir, 'i18n', 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(tempDir, 'i18n', 'locales', 'en.json'), JSON.stringify({ greeting: 'hello' }), 'utf8');
    await writeFile(join(tempDir, 'i18n', 'locales', 'fr.json'), JSON.stringify({ greeting: 'bonjour' }), 'utf8');

    await service.onModuleInit();

    expect(service.getManifest()).toEqual(manifest);
    const en = service.getLocale('en');
    expect(en?.etag).toEqual('sha256-en-version');
    expect(en?.content).toContain('hello');
    const fr = service.getLocale('fr');
    expect(fr?.etag).toEqual('sha256-fr-version');
    expect(fr?.content).toContain('bonjour');
  });

  it('skips manifest entries whose locale file is missing on disk', async () => {
    const manifest = {
      version: '@courthive/i18n@0.1.0',
      generatedAt: '2026-05-16T18:00:00Z',
      locales: [
        {
          code: 'en',
          label: 'English',
          nativeLabel: 'English',
          version: 'sha256-en',
          size: 100,
          keyCount: 10,
          completeness: 1.0,
          rtl: false,
        },
        {
          code: 'cs',
          label: 'Czech',
          nativeLabel: 'Čeština',
          version: 'sha256-cs',
          size: 100,
          keyCount: 10,
          completeness: 1.0,
          rtl: false,
        },
      ],
    };
    await writeFile(join(tempDir, 'i18n', 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(tempDir, 'i18n', 'locales', 'en.json'), JSON.stringify({}), 'utf8');
    // cs.json intentionally missing

    const result = await service.loadFromDisk();
    expect(result.localesLoaded).toEqual(1);
    expect(service.getLocale('en')).toBeDefined();
    expect(service.getLocale('cs')).toBeUndefined();
  });

  it('reports disk state for health checks', async () => {
    let state = await service.getDiskState();
    expect(state.exists).toEqual(true); // i18n/ created in beforeEach
    expect(state.manifestExists).toEqual(false);

    await writeFile(join(tempDir, 'i18n', 'manifest.json'), '{}', 'utf8');
    state = await service.getDiskState();
    expect(state.manifestExists).toEqual(true);
  });

  it('lists locale files present on disk', async () => {
    await writeFile(join(tempDir, 'i18n', 'locales', 'en.json'), '{}', 'utf8');
    await writeFile(join(tempDir, 'i18n', 'locales', 'fr.json'), '{}', 'utf8');
    await writeFile(join(tempDir, 'i18n', 'locales', 'README.txt'), 'ignore me', 'utf8');

    const codes = await service.listLocaleFilesOnDisk();
    expect(codes.sort()).toEqual(['en', 'fr']);
  });

  it('reloadFromDisk clears stale cache before reload', async () => {
    // First load with 1 locale
    let manifest = {
      version: 'v1',
      generatedAt: '2026-05-16T18:00:00Z',
      locales: [
        { code: 'en', label: 'English', nativeLabel: 'English', version: 'v1-en', size: 1, keyCount: 1, completeness: 1, rtl: false },
      ],
    };
    await writeFile(join(tempDir, 'i18n', 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(tempDir, 'i18n', 'locales', 'en.json'), '{}', 'utf8');
    await service.loadFromDisk();
    expect(service.getLocale('en')?.etag).toEqual('v1-en');

    // Second load with different version + removed locale
    manifest = {
      version: 'v2',
      generatedAt: '2026-05-16T19:00:00Z',
      locales: [
        { code: 'fr', label: 'French', nativeLabel: 'Français', version: 'v2-fr', size: 1, keyCount: 1, completeness: 1, rtl: false },
      ],
    };
    await writeFile(join(tempDir, 'i18n', 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(tempDir, 'i18n', 'locales', 'fr.json'), '{}', 'utf8');
    await service.loadFromDisk();

    expect(service.getManifest()?.version).toEqual('v2');
    expect(service.getLocale('en')).toBeUndefined(); // cleared
    expect(service.getLocale('fr')?.etag).toEqual('v2-fr');
  });
});
