import { Inject, Injectable, Logger } from '@nestjs/common';

import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { RankingsWebhookService } from './rankings-webhook.service';
import { stampRecordProvider } from './stampRecordProvider';

// Standard men's / women's ranking lists. A person's points from MIXED events
// still flow into the live /bundle (which buckets by person sex); these gendered
// snapshots are the formal per-list artifacts, filtered by award (event) gender.
const SNAPSHOT_GENDERS = ['MALE', 'FEMALE'];

export interface RecomputeResult {
  skipped?: boolean;
  reason?: string;
  providerId: string;
  republished: Array<{ tournamentId: string; ok: boolean; skipped?: boolean; awardCount?: number; error?: string }>;
  snapshots: Array<{ ageCategoryCode?: string; gender: string; ok: boolean; snapshotId?: string; error?: string }>;
  counts: { tournaments: number; republishedOk: number; snapshotsOk: number };
}

/**
 * Provider-scoped rankings recompute: republish every one of a provider's
 * tournaments to the rankings pipeline (which refreshes the live /bundle the
 * public rankings page reads), then regenerate formal ranking snapshots for
 * each requested age category × gender. Synchronous — returns a per-item
 * summary. The whole thing is a no-op ({ skipped }) when the rankings pipeline
 * is not configured (RANKINGS_PIPELINE_URL unset).
 */
@Injectable()
export class ProviderRankingsService {
  private readonly logger = new Logger(ProviderRankingsService.name);

  constructor(
    private readonly webhook: RankingsWebhookService,
    private readonly tournamentStorage: TournamentStorageService,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
  ) {}

  async recompute(args: {
    providerId: string;
    ageCategoryCodes?: string[];
    asOfDate?: string;
  }): Promise<RecomputeResult> {
    const { providerId } = args;
    const republished: RecomputeResult['republished'] = [];
    const snapshots: RecomputeResult['snapshots'] = [];

    if (!this.webhook.isEnabled()) {
      return {
        skipped: true,
        reason: 'RANKINGS_PIPELINE_URL not set',
        providerId,
        republished,
        snapshots,
        counts: { tournaments: 0, republishedOk: 0, snapshotsOk: 0 },
      };
    }

    const provider: any = await this.providerStorage.getProvider(providerId);
    const providerAbbr = provider?.organisationAbbreviation;

    // 1. Republish every provider tournament (refreshes point_awards → live bundle).
    const tournaments = await this.tournamentStorage.listProviderTournaments({ providerId });
    for (const entry of tournaments) {
      const tournamentId = entry?.tournamentId;
      if (!tournamentId) continue;
      try {
        const fetched: any = await this.tournamentStorage.fetchTournamentRecords({ tournamentIds: [tournamentId] });
        const record = fetched?.tournamentRecords?.[tournamentId];
        if (!record) {
          republished.push({ tournamentId, ok: false, error: 'record not found' });
          continue;
        }
        // Stamp the owning provider so the rankings ingest can scope it (the
        // record's unifiedTournamentId.organisation is otherwise blank for
        // provisioner-created records). See stampRecordProvider.
        stampRecordProvider(record, provider);
        const res = await this.webhook.publish(record, { source: 'cfs-event', sourceRef: `provider-recompute:${providerId}` });
        republished.push({
          tournamentId,
          ok: !!res.ok,
          skipped: res.skipped,
          awardCount: (res.responseBody as any)?.awardCount,
          error: res.error,
        });
      } catch (err: any) {
        republished.push({ tournamentId, ok: false, error: err?.message ?? String(err) });
      }
    }

    // 2. Regenerate formal snapshots per age category × gender. An empty/absent
    //    ageCategoryCodes list means one all-ages snapshot per gender.
    const ageCategoryCodes = args.ageCategoryCodes?.length ? args.ageCategoryCodes : [undefined];
    const asOfDate = args.asOfDate ?? new Date().toISOString().split('T')[0];
    for (const ageCategoryCode of ageCategoryCodes) {
      for (const gender of SNAPSHOT_GENDERS) {
        try {
          const res = await this.webhook.generateSnapshot({ asOfDate, ageCategoryCode, gender, providerAbbr });
          snapshots.push({
            ageCategoryCode,
            gender,
            ok: !!res.ok,
            snapshotId: (res.responseBody as any)?.snapshotId,
            error: res.error,
          });
        } catch (err: any) {
          snapshots.push({ ageCategoryCode, gender, ok: false, error: err?.message ?? String(err) });
        }
      }
    }

    const counts = {
      tournaments: republished.length,
      republishedOk: republished.filter((r) => r.ok).length,
      snapshotsOk: snapshots.filter((s) => s.ok).length,
    };
    this.logger.log(
      `provider-recompute provider=${providerId} tournaments=${counts.tournaments} ok=${counts.republishedOk} snapshots=${counts.snapshotsOk}`,
    );

    return { providerId, republished, snapshots, counts };
  }
}
