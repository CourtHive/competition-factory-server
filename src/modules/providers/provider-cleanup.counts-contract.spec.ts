import { ProviderCleanupService } from './provider-cleanup.service';
import contract from './cleanupCounts.contract.json';

// The courthive-ams console renders these counts. It drifted once: tables were dropped here (041, 048, 049, 053), the
// console kept rendering their counts, and both provider modals threw before opening (courthive-ams #260). The key list
// is the contract; courthive-ams checks its own type against the same file.
describe('ProviderCleanupService.getCounts — console contract', () => {
  const row = {
    tournaments: '3',
    user_associations: '2',
    provisioner_associations: '1',
    tournament_assignments: '4',
    tournament_provisioner: '1',
    calendar_tournaments: '3',
    topologies: '1',
    catalog_items: '5',
    audit_log_rows: '40',
  };
  const service = (summary: any) =>
    new ProviderCleanupService(
      { query: vi.fn(async () => ({ rows: [row] })) } as any,
      { summarize: vi.fn(async () => summary) } as any,
    );
  const sorted = (keys: string[]) => [...keys].sort((a, b) => a.localeCompare(b));

  it('returns exactly the contracted keys, every one a number', async () => {
    const counts: any = await service({ ok: true, active: 6, deleted: 0 }).getCounts('p-1');
    expect(sorted(Object.keys(counts))).toEqual(sorted(contract.keys));
    for (const key of contract.keys) expect(typeof counts[key]).toBe('number');
  });

  it('returns null only for the contracted nullable keys, when AMS cannot be reached', async () => {
    const counts: any = await service({ ok: false, active: 0, deleted: 0, reason: 'unreachable' }).getCounts('p-1');
    const nulls = contract.keys.filter((key) => counts[key] === null);
    expect(nulls).toEqual(contract.nullable);
  });
});
