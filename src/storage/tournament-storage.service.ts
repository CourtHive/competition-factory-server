import { Inject, Injectable } from '@nestjs/common';

import { TOURNAMENT_STORAGE, type ITournamentStorage } from './interfaces/tournament-storage.interface';
import { PROVIDER_STORAGE, type IProviderStorage } from './interfaces/provider-storage.interface';
import { CALENDAR_STORAGE, type ICalendarStorage } from './interfaces/calendar-storage.interface';
import { CREATED_BY_USER_ID } from 'src/modules/factory/helpers/checkTournamentAccess';
import type { UserContext } from 'src/modules/auth/decorators/user-context.decorator';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';

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

  /**
   * Save a tournament record with domain side-effects.
   *
   * @param opts.userId - The UUID of the saving user. On first save (no
   *   existing createdByUserId extension), stamps the extension so the
   *   access-control helper can trace tournament ownership.
   */
  async saveTournamentRecord({ tournamentRecord, userId }: { tournamentRecord: any; userId?: string }) {
    const key = tournamentRecord?.tournamentId;
    if (!key) return { error: 'Invalid tournamentRecord' };

    const providerId = tournamentRecord.parentOrganisation?.organisationId;
    if (!providerId && key !== TEST) return { error: 'Missing providerId' };

    // Stamp createdByUserId on first save if a userId is available
    if (userId) {
      this.stampCreatedBy(tournamentRecord, userId);
    }

    if (providerId) {
      await this.addToOrUpdateCalendar({ providerId, tournamentRecord });
    }

    return this.tournamentStorage.saveTournamentRecord({ tournamentRecord });
  }

  async saveTournamentRecords(params: { tournamentRecords?: Record<string, any>; tournamentRecord?: any; userId?: string }) {
    const tournamentRecords = this.extractTournamentRecords(params);

    for (const tournamentId of Object.keys(tournamentRecords)) {
      const result: any = await this.saveTournamentRecord({
        tournamentRecord: tournamentRecords[tournamentId],
        userId: params.userId,
      });
      if (result.error) return result;
    }

    return { ...SUCCESS };
  }

  async removeTournamentRecords(
    params: { tournamentIds?: string[]; tournamentId?: string; providerId?: string },
    user?: any,
    auditService?: any,
    userContext?: UserContext,
  ) {
    const tournamentIds: string[] =
      params?.tournamentIds ?? ([params?.tournamentId].filter(Boolean) as string[]);
    const providerId: string | undefined = user?.providerId || params.providerId;
    let removed = 0;

    for (const tournamentId of tournamentIds) {
      // Resolve auth in three layers, cheapest first:
      // 1. Per-user `permissions` array (legacy granular grant) — or no
      //    permissions field at all (back-compat for older user records).
      // 2. SUPER_ADMIN role.
      // 3. PROVIDER_ADMIN at the tournament's owning provider — provider
      //    admins logically should be able to delete their own provider's
      //    tournaments without needing the separate `deleteTournament`
      //    permission checkbox. Requires loading the tournament record.
      let hasDeletePermission =
        !user?.permissions ||
        user.permissions.includes('deleteTournament') ||
        user.roles?.includes('superadmin');

      let isCreator = false;
      let existingRecord: any;
      if (!hasDeletePermission && user?.userId) {
        const existing: any = await this.tournamentStorage.findTournamentRecord({ tournamentId });
        existingRecord = existing?.tournamentRecord;
        const createdBy = (existingRecord?.extensions ?? []).find((e) => e?.name === 'createdByUserId')?.value;
        isCreator = !!createdBy && createdBy === user.userId;

        // PROVIDER_ADMIN at the tournament's provider also implies delete.
        if (!isCreator && userContext) {
          const tournamentProviderId = existingRecord?.parentOrganisation?.organisationId;
          if (
            tournamentProviderId &&
            userContext.providerRoles?.[tournamentProviderId] === PROVIDER_ADMIN
          ) {
            hasDeletePermission = true;
          }
        }
      }

      if (hasDeletePermission || isCreator) {
        // Record the deletion in the audit trail BEFORE removing the record.
        // Fail-soft: audit errors don't block the deletion.
        if (auditService?.recordDeletion) {
          try {
            if (!existingRecord) {
              const existing: any = await this.tournamentStorage.findTournamentRecord({ tournamentId });
              existingRecord = existing?.tournamentRecord;
            }
            await auditService.recordDeletion({
              tournamentId,
              tournamentName: existingRecord?.tournamentName,
              providerId: existingRecord?.parentOrganisation?.organisationId ?? providerId,
              userId: user?.userId,
              userEmail: user?.email,
            });
          } catch {
            // Audit failure is non-blocking
          }
        }

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

  /**
   * Write the createdByUserId extension if not already present.
   * Only stamps on the FIRST save — subsequent saves preserve the original creator.
   */
  private stampCreatedBy(tournamentRecord: any, userId: string): void {
    if (!tournamentRecord || !userId) return;
    tournamentRecord.extensions ??= [];
    const existing = tournamentRecord.extensions.find((ext) => ext?.name === CREATED_BY_USER_ID);
    if (!existing) {
      tournamentRecord.extensions.push({ name: CREATED_BY_USER_ID, value: userId });
    }
  }

  private extractTournamentRecords(params: any) {
    return (
      params?.tournamentRecords ??
      (params?.tournamentRecord ? { [params.tournamentRecord.tournamentId]: params.tournamentRecord } : {})
    );
  }
}
