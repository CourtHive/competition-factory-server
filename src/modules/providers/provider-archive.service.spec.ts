import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { ProviderArchiveService } from './provider-archive.service';

/**
 * The archive is the thing that makes a provider decommission recoverable, so what it
 * CAPTURES is the whole contract.
 *
 * Until 2026-09-21 it captured the abbr-keyed legacy `calendars` table and never
 * `calendar_tournaments`, which migration 047 had already made authoritative. Two
 * consequences, both silent: the archived calendar was a stale projection (BOBOCA measured
 * 30 entries against 33 real tournaments), and `revive-provider.mjs` restored it into a
 * table no read path consulted — so a decommission → revive round trip returned a provider
 * with no calendar at all.
 *
 * These assertions are about which table is read, which is exactly what went wrong. They
 * would all have passed before the fix except the two that name `calendar_tournaments`.
 */
describe('ProviderArchiveService — what a decommission preserves', () => {
  let archivesPath: string;
  let queries: Array<{ sql: string; params: any[] }>;

  const PROVIDER = { providerId: 'p-uuid-1', providerAbbr: 'TESTORG', providerName: 'Test Org' };

  function buildService(amsOverrides?: any) {
    queries = [];
    const pool: any = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        // `tournaments` drives a per-record file loop; everything else is row arrays.
        if (sql.includes('FROM tournaments')) return { rows: [] };
        if (sql.includes('FROM audit_log')) return { rows: [] };
        return { rows: [] };
      }),
    };
    // A stubbed AMS client: policies are AMS's (P31), and the archive must stay unit-testable
    // without a live AMS. `amsOverrides` lets a test drive the unavailable path.
    const amsPolicies: any = {
      exportForProvider: vi.fn(async () => ({ ok: true, policies: [], archivedPolicyIds: [] })),
      ...(amsOverrides ?? {}),
    };
    return new ProviderArchiveService(pool, amsPolicies);
  }

  beforeEach(async () => {
    archivesPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cfs-archive-spec-'));
    process.env.ARCHIVES_PATH = archivesPath;
  });

  afterEach(async () => {
    delete process.env.ARCHIVES_PATH;
    await fs.rm(archivesPath, { recursive: true, force: true });
  });

  // ── AMS policies in the archive (punch-list P31) ─────────────────────────

  it('writes the AMS policies into the archive, with the ids a revive should restore', async () => {
    const exportForProvider = vi.fn(async () => ({
      ok: true,
      policies: [
        { policyId: 'live-1', deletedAt: null },
        { policyId: 'already-deleted', deletedAt: '2026-03-01T00:00:00Z' },
      ],
      archivedPolicyIds: ['live-1'],
    }));

    const result = await buildService({ exportForProvider }).writeArchive(PROVIDER);
    const written = JSON.parse(await fs.readFile(path.join(result.archivePath, 'policies.json'), 'utf8'));

    expect(exportForProvider).toHaveBeenCalledWith(PROVIDER.providerId);
    // both rows are preserved, so the archive reproduces the provider's state...
    expect(written.policies).toHaveLength(2);
    // ...but only the one archiving actually soft-deleted is marked for restore. Restoring the
    // other would resurrect a deletion the provider made themselves.
    expect(written.archivedPolicyIds).toEqual(['live-1']);
  });

  it('records that policies were UNAVAILABLE rather than writing an empty archive that looks complete', async () => {
    const exportForProvider = vi.fn(async () => ({
      ok: false,
      policies: [],
      archivedPolicyIds: [],
      reason: 'HTTP 503',
    }));

    const result = await buildService({ exportForProvider }).writeArchive(PROVIDER);
    const written = JSON.parse(await fs.readFile(path.join(result.archivePath, 'policies.json'), 'utf8'));

    // The distinction that matters: "AMS was down" must not read as "this provider had no policies".
    expect(written.unavailable).toEqual('HTTP 503');
    expect(written.archivedPolicyIds).toEqual([]);
  });

  it('does not abort the decommission when AMS is unreachable', async () => {
    const exportForProvider = vi.fn(async () => ({
      ok: false,
      policies: [],
      archivedPolicyIds: [],
      reason: 'ECONNREFUSED',
    }));
    await expect(buildService({ exportForProvider }).writeArchive(PROVIDER)).resolves.toBeDefined();
  });

  it('reads calendar_tournaments, scoped by the immutable provider_id', async () => {
    await buildService().writeArchive(PROVIDER);

    const calendarQuery = queries.find((q) => q.sql.includes('FROM calendar_tournaments'));
    expect(calendarQuery).toBeDefined();
    // provider_id, never provider_abbr: the abbreviation is mutable, and a renamed provider
    // would archive nothing at all if this were keyed on it.
    expect(calendarQuery?.sql).toContain('WHERE provider_id = $1');
    expect(calendarQuery?.params).toEqual([PROVIDER.providerId]);
  });

  it('never reads the retired calendars table', async () => {
    await buildService().writeArchive(PROVIDER);

    const legacy = queries.filter((q) => /\bFROM calendars\b/.test(q.sql));
    expect(legacy).toEqual([]);
  });

  it('writes calendar_tournaments.json and no calendar.json', async () => {
    const result = await buildService().writeArchive(PROVIDER);

    const written = await fs.readdir(result.archivePath);
    expect(written).toContain('calendar_tournaments.json');
    // The old name is what revive looked for; leaving it behind would let a stale reader
    // believe the calendar had been captured.
    expect(written).not.toContain('calendar.json');
  });

  it('records the calendar file in the manifest, so integrity checking covers it', async () => {
    const result = await buildService().writeArchive(PROVIDER);

    const manifest = JSON.parse(await fs.readFile(path.join(result.archivePath, 'manifest.json'), 'utf8'));
    expect(manifest.files['calendar_tournaments.json']).toMatchObject({
      sha256: expect.any(String),
      bytes: expect.any(Number),
    });
    expect(manifest.files['calendar.json']).toBeUndefined();
  });
});
