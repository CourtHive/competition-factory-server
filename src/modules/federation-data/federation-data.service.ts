import { Inject, Injectable, Logger } from '@nestjs/common';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { CALENDAR_STORAGE, type ICalendarStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

import { FederationDataAdapter, FEDERATION_ADAPTERS } from './FederationDataAdapter';

// Provider-agnostic dispatcher. Iterates registered adapters, picks the
// first whose `canHandle()` matches the incoming identifier, delegates the
// fetch, then applies common storage side-effects (calendar dedup +
// persist). The audit call (`federation_adapter_calls`) is stubbed here as
// a non-blocking best-effort hook; the table is provisioned via migration
// `023-add-federation-adapter-calls.sql`. A full
// `IFederationAdapterCallStorage` abstraction is a follow-up.

interface AuditEntry {
  provider: string;
  operation: string;
  identifier: string;
  status: 'ok' | 'parse_error' | 'http_error' | 'no_adapter' | 'rate_limited';
  durationMs: number;
}

@Injectable()
export class FederationDataService {
  private readonly logger = new Logger(FederationDataService.name);

  constructor(
    @Inject(FEDERATION_ADAPTERS) private readonly adapters: FederationDataAdapter[],
    private readonly tournamentStorageService: TournamentStorageService,
    @Inject(CALENDAR_STORAGE) private readonly calendarStorage: ICalendarStorage,
  ) {}

  async fetchTournamentDetails({ identifier }: { identifier: string }) {
    if (typeof identifier !== 'string') return { error: 'Invalid parameters' };

    const adapter = this.adapters.find((a) => a.canHandle(identifier));
    if (!adapter) {
      void this.recordCall({
        provider: 'unknown',
        operation: 'fetchTournament',
        identifier,
        status: 'no_adapter',
        durationMs: 0,
      });
      return { error: 'NO_ADAPTER_FOR_IDENTIFIER' };
    }

    const t0 = Date.now();
    try {
      const result: any = await adapter.fetchTournament(identifier);
      if (result?.error) {
        void this.recordCall({
          provider: adapter.provider,
          operation: 'fetchTournament',
          identifier,
          status: 'parse_error',
          durationMs: Date.now() - t0,
        });
        return result;
      }

      const providerCalendar: any = await this.calendarStorage.getCalendar(adapter.organizationId);
      const existing = (providerCalendar?.tournaments ?? []).map((t: any) => t.tournamentId);
      if (!existing.includes(result.tournamentId)) {
        await this.tournamentStorageService.saveTournamentRecord({ tournamentRecord: result });
      }

      void this.recordCall({
        provider: adapter.provider,
        operation: 'fetchTournament',
        identifier,
        status: 'ok',
        durationMs: Date.now() - t0,
      });

      return { ...SUCCESS, tournamentRecord: result };
    } catch (err) {
      void this.recordCall({
        provider: adapter.provider,
        operation: 'fetchTournament',
        identifier,
        status: 'http_error',
        durationMs: Date.now() - t0,
      });
      this.logger.error(`federation-data fetch failed (${adapter.provider}): ${(err as Error)?.message}`);
      return { error: 'request failed' };
    }
  }

  // Stub — wire to IFederationAdapterCallStorage in a follow-up PR. Migration
  // 023 provisions the `federation_adapter_calls` table that this will write to.
  // Logs at debug for now so audit-pipeline development can correlate calls
  // against the (then-empty) table.
  private async recordCall(entry: AuditEntry): Promise<void> {
    this.logger.debug?.(
      `federation-data audit: provider=${entry.provider} op=${entry.operation} status=${entry.status} ms=${entry.durationMs}`,
    );
    return Promise.resolve();
  }
}
