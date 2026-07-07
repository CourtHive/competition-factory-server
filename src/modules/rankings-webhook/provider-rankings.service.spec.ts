import { ProviderRankingsService } from './provider-rankings.service';

const PROVIDER_ID = 'prov-1';
const ABBR = 'PROV';

function build(overrides: { enabled?: boolean } = {}) {
  const webhook: any = {
    isEnabled: jest.fn().mockReturnValue(overrides.enabled ?? true),
    publish: jest.fn().mockResolvedValue({ ok: true, responseBody: { awardCount: 12 } }),
    generateSnapshot: jest.fn().mockResolvedValue({ ok: true, responseBody: { snapshotId: 'snap-x' } }),
  };
  const tournamentStorage: any = {
    listProviderTournaments: jest.fn().mockResolvedValue([{ tournamentId: 't1' }, { tournamentId: 't2' }]),
    fetchTournamentRecords: jest.fn().mockImplementation(({ tournamentIds }: any) => {
      const id = tournamentIds[0];
      return Promise.resolve({ tournamentRecords: { [id]: { tournamentId: id } } });
    }),
  };
  const providerStorage: any = {
    getProvider: jest.fn().mockResolvedValue({ organisationAbbreviation: ABBR }),
  };
  const service = new ProviderRankingsService(webhook, tournamentStorage, providerStorage);
  return { service, webhook, tournamentStorage, providerStorage };
}

describe('ProviderRankingsService.recompute', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a no-op when the rankings pipeline is not configured', async () => {
    const { service, webhook, tournamentStorage } = build({ enabled: false });
    const res = await service.recompute({ providerId: PROVIDER_ID });
    expect(res.skipped).toBe(true);
    expect(res.reason).toContain('RANKINGS_PIPELINE_URL');
    expect(webhook.publish).not.toHaveBeenCalled();
    expect(tournamentStorage.listProviderTournaments).not.toHaveBeenCalled();
  });

  it('republishes every provider tournament and generates M/F snapshots (all-ages by default)', async () => {
    const { service, webhook } = build();
    const res = await service.recompute({ providerId: PROVIDER_ID, asOfDate: '2026-07-04' });

    expect(webhook.publish).toHaveBeenCalledTimes(2);
    expect(res.counts.tournaments).toBe(2);
    expect(res.counts.republishedOk).toBe(2);
    expect(res.republished[0]).toMatchObject({ tournamentId: 't1', ok: true, awardCount: 12 });

    // 1 (all-ages) × 2 genders = 2 snapshots, each passing the provider abbr.
    expect(webhook.generateSnapshot).toHaveBeenCalledTimes(2);
    expect(webhook.generateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ asOfDate: '2026-07-04', ageCategoryCode: undefined, gender: 'MALE', providerAbbr: ABBR }),
    );
    expect(res.counts.snapshotsOk).toBe(2);
  });

  it('expands snapshots across ageCategoryCodes × gender', async () => {
    const { service, webhook } = build();
    const res = await service.recompute({ providerId: PROVIDER_ID, ageCategoryCodes: ['OPEN', 'U18'] });
    // 2 age categories × 2 genders = 4 snapshots.
    expect(webhook.generateSnapshot).toHaveBeenCalledTimes(4);
    expect(res.snapshots).toHaveLength(4);
    expect(res.snapshots.map((s) => s.ageCategoryCode).sort()).toEqual(['OPEN', 'OPEN', 'U18', 'U18']);
  });

  it('stamps the resolved provider onto each record so the rankings ingest can scope it', async () => {
    // Regression: provisioner-created records (e.g. BOBOCA) lack
    // unifiedTournamentId.organisation, which left ingestion_runs.provider_id
    // blank and broke the provider-scoped bundle. The recompute must stamp it.
    const { service, webhook, providerStorage } = build();
    providerStorage.getProvider.mockResolvedValue({ organisationAbbreviation: ABBR, organisationName: 'Prov Org' });
    await service.recompute({ providerId: PROVIDER_ID });
    const [record] = webhook.publish.mock.calls[0];
    expect(record.unifiedTournamentId.organisation).toEqual({ organisationId: ABBR, organisationName: 'Prov Org' });
  });

  it('records a per-tournament error when the record cannot be fetched', async () => {
    const { service, tournamentStorage } = build();
    tournamentStorage.fetchTournamentRecords.mockResolvedValueOnce({ tournamentRecords: {} });
    const res = await service.recompute({ providerId: PROVIDER_ID });
    expect(res.republished[0]).toMatchObject({ tournamentId: 't1', ok: false, error: 'record not found' });
    expect(res.counts.republishedOk).toBe(1); // t2 still succeeds
  });
});
