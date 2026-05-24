import { Inject, Injectable } from '@nestjs/common';

import { TOURNAMENT_STORAGE, type ITournamentStorage } from './interfaces/tournament-storage.interface';
import { PROVIDER_STORAGE, type IProviderStorage } from './interfaces/provider-storage.interface';
import { CALENDAR_STORAGE, type ICalendarStorage } from './interfaces/calendar-storage.interface';
import { CREATED_BY_USER_ID, canDeleteTournament } from 'src/modules/factory/helpers/checkTournamentAccess';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

import { getCalendarEntry } from 'src/helpers/getCalendarEntry';
import { SUCCESS } from 'src/common/constants/app';
import { isTestTournamentId } from 'src/common/constants/test';

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
    if (!providerId && !isTestTournamentId(key)) return { error: 'Missing providerId' };

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
    let removed = 0;

    for (const tournamentId of tournamentIds) {
      const result = await this.deleteSingleTournament({ tournamentId, user, userContext, auditService });
      if (result.error) return { ...result, removed };
      if (result.removed) removed += 1;
    }

    return { ...SUCCESS, removed };
  }

  /**
   * Delete one tournament with all safety gates, in order:
   *   1. Provider-scoped authorization (canDeleteTournament — always enforced).
   *   2. End-date guard: a non-mock tournament may only be deleted once its
   *      endDate is in the past (move the end date back to delete an active one).
   *   3. Archive the full record (HARD prerequisite — abort the delete if it fails).
   *   4. Audit (fail-soft).
   *   5. Remove the row, then detach from its OWN provider's calendar.
   */
  private async deleteSingleTournament({
    tournamentId,
    user,
    userContext,
    auditService,
  }: {
    tournamentId: string;
    user?: any;
    userContext?: UserContext;
    auditService?: any;
  }): Promise<{ removed?: boolean; error?: string; errorCode?: string }> {
    const existing: any = await this.tournamentStorage.findTournamentRecord({ tournamentId });
    const existingRecord = existing?.tournamentRecord;
    if (!existingRecord) return { removed: false }; // Nothing to delete.

    if (!this.isDeleteAuthorized(existingRecord, user, userContext)) {
      return { error: 'Not authorized to delete this tournament', errorCode: 'ERR_DELETE_FORBIDDEN' };
    }

    const guard = this.checkDeletableByEndDate(existingRecord);
    if (guard.error) return guard;

    // Archive BEFORE deleting — a failed archive must abort the delete so the
    // record is always recoverable.
    const archiveResult: any = await this.tournamentStorage.archiveTournamentRecord({
      tournamentRecord: existingRecord,
      deletedByUserId: user?.userId,
      deletedByEmail: user?.email,
    });
    if (archiveResult?.error) {
      return { error: 'Could not archive tournament; deletion aborted', errorCode: 'ERR_ARCHIVE_FAILED' };
    }

    await this.recordDeletionSafely({ auditService, tournamentId, existingRecord, user });

    await this.tournamentStorage.removeTournamentRecords({ tournamentIds: [tournamentId] });

    // Detach from the tournament's OWN provider's calendar (not the actor's).
    const tournamentProviderId = existingRecord?.parentOrganisation?.organisationId;
    if (tournamentProviderId) {
      await this.removeFromCalendar({ providerId: tournamentProviderId, tournamentId });
    }

    return { removed: true };
  }

  /**
   * Provider-scoped delete authorization. A global `deleteTournament` permission
   * is a capability, NOT a cross-tenant scope grant — scope is decided by
   * canDeleteTournament against the tournament's own provider. Legacy SUPER_ADMIN
   * via `user.roles` is honored when no userContext is present (fail closed otherwise).
   */
  private isDeleteAuthorized(tournamentRecord: any, user: any, userContext?: UserContext): boolean {
    if (userContext) return canDeleteTournament(tournamentRecord, userContext);
    return !!user?.roles?.includes('superadmin');
  }

  /**
   * Non-mock tournaments may only be deleted once their endDate is in the past.
   * Mock tournaments (isMock) are exempt. To delete an in-progress tournament,
   * a director first moves its endDate to a past date.
   */
  private checkDeletableByEndDate(tournamentRecord: any): { error?: string; errorCode?: string } {
    if (tournamentRecord?.isMock === true) return {};
    const endDate: string | undefined = tournamentRecord?.endDate;
    const today = new Date().toISOString().slice(0, 10);
    if (endDate && endDate < today) return {};
    return {
      error: 'Cannot delete a tournament before its end date. Set the end date to a past date first, then delete.',
      errorCode: 'ERR_TOURNAMENT_NOT_ENDED',
    };
  }

  private async recordDeletionSafely({
    auditService,
    tournamentId,
    existingRecord,
    user,
  }: {
    auditService?: any;
    tournamentId: string;
    existingRecord: any;
    user?: any;
  }): Promise<void> {
    if (!auditService?.recordDeletion) return;
    try {
      await auditService.recordDeletion({
        tournamentId,
        tournamentName: existingRecord?.tournamentName,
        providerId: existingRecord?.parentOrganisation?.organisationId,
        userId: user?.userId,
        userEmail: user?.email,
      });
    } catch {
      // Audit failure is non-blocking.
    }
  }

  // --- Calendar side-effect helpers ---

  async addToOrUpdateCalendar({ providerId, tournamentRecord }: { providerId: string; tournamentRecord: any }) {
    const providerResult = await this.getProviderCalendar({ providerId });
    if (providerResult.error) return providerResult;

    const { provider, tournaments } = providerResult;
    const calendarEntry = getCalendarEntry({ tournamentRecord });
    if (!calendarEntry) return this.updateCalendar({ provider, tournaments });

    const exists = tournaments.some((entry) => entry.tournamentId === calendarEntry.tournamentId);
    const updatedEntries = exists
      ? tournaments.map((entry) => (entry.tournamentId === calendarEntry.tournamentId ? calendarEntry : entry))
      : [...tournaments, calendarEntry];

    // First time this tournament appears in THIS provider's calendar (create or
    // provider move): detach it from any OTHER provider's calendar so a moved
    // tournament never lingers under its source provider (incident 2026-05-23).
    if (!exists) {
      await this.detachFromOtherCalendars({
        tournamentId: calendarEntry.tournamentId,
        keepAbbr: provider?.organisationAbbreviation,
      });
    }

    return this.updateCalendar({ provider, tournaments: updatedEntries });
  }

  /**
   * Remove a tournament from every provider calendar except `keepAbbr`, enforcing
   * the invariant that a tournament lives in exactly one provider's calendar —
   * its current parentOrganisation provider.
   */
  private async detachFromOtherCalendars({
    tournamentId,
    keepAbbr,
  }: {
    tournamentId: string;
    keepAbbr?: string;
  }): Promise<void> {
    const calendars = await this.calendarStorage.listCalendars();
    for (const { key, value } of calendars) {
      if (key === keepAbbr) continue;
      const entries: any[] = value?.tournaments ?? [];
      if (!entries.some((entry) => entry.tournamentId === tournamentId)) continue;
      const filtered = entries.filter((entry) => entry.tournamentId !== tournamentId);
      await this.calendarStorage.setCalendar(key, { provider: value.provider, tournaments: filtered });
    }
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
