import { Inject, Injectable } from '@nestjs/common';

import { TOURNAMENT_STORAGE, type ITournamentStorage } from './interfaces/tournament-storage.interface';
import { PROVIDER_STORAGE, type IProviderStorage } from './interfaces/provider-storage.interface';
import { CALENDAR_STORAGE, type ICalendarStorage } from './interfaces/calendar-storage.interface';

import { getCalendarEntry } from 'src/helpers/getCalendarEntry';
import { SUCCESS } from 'src/common/constants/app';
import { TEST } from 'src/common/constants/test';

/**
 * Facade over ITournamentStorage that adds domain side-effects:
 * - Calendar updates on save
 * - Calendar cleanup on delete
 * - Permission checks on delete
 *
 * All controllers/services should use this instead of ITournamentStorage directly
 * when writes involve domain logic.
 */
@Injectable()
export class TournamentStorageService {
  constructor(
    @Inject(TOURNAMENT_STORAGE) private readonly tournamentStorage: ITournamentStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(CALENDAR_STORAGE) private readonly calendarStorage: ICalendarStorage,
  ) {}

  // --- Read-through (no side-effects) ---

  async findTournamentRecord(params: { tournamentId: string }) {
    return this.tournamentStorage.findTournamentRecord(params);
  }

  async fetchTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }) {
    return this.tournamentStorage.fetchTournamentRecords(params);
  }

  async listTournamentIds() {
    return this.tournamentStorage.listTournamentIds();
  }

  // --- Writes with side-effects ---

  async saveTournamentRecord({ tournamentRecord }: { tournamentRecord: any }) {
    const key = tournamentRecord?.tournamentId;
    if (!key) return { error: 'Invalid tournamentRecord' };

    const providerId = tournamentRecord.parentOrganisation?.organisationId;
    if (!providerId && key !== TEST) return { error: 'Missing providerId' };

    if (providerId) {
      await this.addToOrUpdateCalendar({ providerId, tournamentRecord });
    }

    return this.tournamentStorage.saveTournamentRecord({ tournamentRecord });
  }

  async saveTournamentRecords(params: { tournamentRecords?: Record<string, any>; tournamentRecord?: any }) {
    const tournamentRecords = this.extractTournamentRecords(params);

    for (const tournamentId of Object.keys(tournamentRecords)) {
      const result: any = await this.saveTournamentRecord({ tournamentRecord: tournamentRecords[tournamentId] });
      if (result.error) return result;
    }

    return { ...SUCCESS };
  }

  async removeTournamentRecords(
    params: { tournamentIds?: string[]; tournamentId?: string; providerId?: string },
    user?: any,
  ) {
    const tournamentIds: string[] =
      params?.tournamentIds ?? ([params?.tournamentId].filter(Boolean) as string[]);
    const providerId: string | undefined = user?.providerId || params.providerId;
    let removed = 0;

    for (const tournamentId of tournamentIds) {
      if (!user?.permissions || user.permissions.includes('deleteTournament') || user.roles?.includes('superadmin')) {
        await this.tournamentStorage.removeTournamentRecords({ tournamentIds: [tournamentId] });
        if (providerId) {
          await this.removeFromCalendar({ providerId, tournamentId });
          removed += 1;
        }
      }
    }

    return { ...SUCCESS, removed };
  }

  // --- Calendar side-effect helpers ---

  async addToOrUpdateCalendar({ providerId, tournamentRecord }: { providerId: string; tournamentRecord: any }) {
    const providerResult = await this.getProviderCalendar({ providerId });
    if (providerResult.error) return providerResult;

    const { provider, tournaments } = providerResult;
    let updatedEntries = tournaments;
    const calendarEntry = getCalendarEntry({ tournamentRecord });

    if (calendarEntry) {
      let modified = false;
      const modifiedTournaments = tournaments.map((entry) => {
        if (entry.tournamentId === calendarEntry.tournamentId) {
          modified = true;
          return calendarEntry;
        }
        return entry;
      });

      if (modified) {
        updatedEntries = modifiedTournaments;
      } else {
        updatedEntries.push(calendarEntry);
      }
    }

    return this.updateCalendar({ provider, tournaments: updatedEntries });
  }

  async removeFromCalendar({ providerId, tournamentId }: { providerId: string; tournamentId: string }) {
    const providerResult = await this.getProviderCalendar({ providerId });
    if (providerResult.error) return providerResult;

    const { provider, tournaments } = providerResult;
    const updatedEntries = tournaments.filter((tournament) => tournament.tournamentId !== tournamentId);
    return this.updateCalendar({ provider, tournaments: updatedEntries });
  }

  async modifyProviderCalendar({
    providerId,
    tournamentId,
    updates,
  }: {
    providerId: string;
    tournamentId: string;
    updates: any;
  }) {
    const providerResult = await this.getProviderCalendar({ providerId });
    if (providerResult.error) return providerResult;

    const existingEntry = providerResult.tournaments.find((tournament) => tournament.tournamentId === tournamentId);
    if (!existingEntry) return { error: 'Tournament not found' };

    const { provider, tournaments } = providerResult;
    const updatedEntries = tournaments.map((entry) => {
      if (entry.tournamentId === tournamentId) {
        const searchText = updates.tournamentName?.toLowerCase() || entry.searchText;
        const tournament = { ...entry.tournament, ...updates };
        return { searchText, tournamentId, providerId, tournament };
      }
      return entry;
    });

    return this.updateCalendar({ provider, tournaments: updatedEntries });
  }

  // --- Private helpers ---

  private async getProviderCalendar({ providerId }: { providerId: string }) {
    const provider: any = await this.providerStorage.getProvider(providerId);
    const providerAbbr = provider?.organisationAbbreviation;
    if (!providerAbbr) return { error: 'Provider not found' };

    const calendarResult: any = await this.calendarStorage.getCalendar(providerAbbr);
    const tournaments = calendarResult?.tournaments ?? [];
    return { provider, tournaments };
  }

  private async updateCalendar({ provider, tournaments }: { provider: any; tournaments: any[] }) {
    const key = provider?.organisationAbbreviation;
    if (key) await this.calendarStorage.setCalendar(key, { provider, tournaments });
    return { ...SUCCESS };
  }

  private extractTournamentRecords(params: any) {
    return (
      params?.tournamentRecords ??
      (params?.tournamentRecord ? { [params.tournamentRecord.tournamentId]: params.tournamentRecord } : {})
    );
  }
}
