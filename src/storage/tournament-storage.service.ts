import { Inject, Injectable, Logger } from '@nestjs/common';

import { TOURNAMENT_STORAGE, type ITournamentStorage } from './interfaces/tournament-storage.interface';
import { PROVIDER_STORAGE, type IProviderStorage } from './interfaces/provider-storage.interface';
import { CALENDAR_STORAGE, type ICalendarStorage } from './interfaces/calendar-storage.interface';
import { PARTICIPATION_STORAGE, type IParticipationStorage } from './interfaces/participation-storage.interface';
import { PROJECTION_OUTBOX_STORAGE, type IProjectionOutboxStorage } from './interfaces/projection-outbox-storage.interface';
import { CREATED_BY_USER_ID, canDeleteTournament } from 'src/modules/factory/helpers/checkTournamentAccess';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

import { deriveParticipationRows } from 'src/helpers/participationRows';
import { getCalendarEntry } from 'src/helpers/getCalendarEntry';
import { isCalendarListed } from 'src/helpers/calendarListing';
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
  private readonly logger = new Logger(TournamentStorageService.name);

  constructor(
    @Inject(TOURNAMENT_STORAGE) private readonly tournamentStorage: ITournamentStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(CALENDAR_STORAGE) private readonly calendarStorage: ICalendarStorage,
    @Inject(PROJECTION_OUTBOX_STORAGE) private readonly projectionOutbox: IProjectionOutboxStorage,
    @Inject(PARTICIPATION_STORAGE) private readonly participationStorage: IParticipationStorage,
  ) {}

  // --- Read-through (no side-effects) ---

  async findTournamentRecord(params: { tournamentId: string }) {
    return this.tournamentStorage.findTournamentRecord(params);
  }

  async fetchTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }) {
    return this.tournamentStorage.fetchTournamentRecords(params);
  }

  async fetchTournamentUpdatedAt(params: { tournamentId?: string }) {
    return this.tournamentStorage.fetchTournamentUpdatedAt(params);
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
  async saveTournamentRecord({
    tournamentRecord,
    ownerEpoch,
    userId,
  }: {
    tournamentRecord: any;
    ownerEpoch?: number;
    userId?: string;
  }) {
    const key = tournamentRecord?.tournamentId;
    if (!key) return { error: 'Invalid tournamentRecord' };

    const providerId = tournamentRecord.parentOrganisation?.organisationId;
    if (!providerId && !isTestTournamentId(key)) return { error: 'Missing providerId' };

    // Stamp createdByUserId on first save if a userId is available
    if (userId) {
      this.stampCreatedBy(tournamentRecord, userId);
    }

    // Ownership and calendar listing are separate decisions. An unlisted record touches the
    // calendar not at all — no read, no rewrite, no `listCalendars()` detach sweep — which is what
    // makes storing tens of thousands of fixtures under one provider affordable.
    if (providerId && isCalendarListed(tournamentRecord)) {
      await this.addToOrUpdateCalendar({ providerId, tournamentRecord });
    }

    await this.updateParticipationIndex(tournamentRecord);

    return this.tournamentStorage.saveTournamentRecord({ tournamentRecord, ownerEpoch });
  }

  /**
   * `projectionMode` is REQUIRED, not defaulted, and is the seam between the two
   * ways a tournament reaches storage:
   *
   * - `'deltas'`  — the caller came through `executionQueue`, which raised
   *                 factory notices and already filled a delta buffer it flushes
   *                 post-commit. This facade must not project anything.
   * - `'snapshot'`— the caller replaced the record WHOLESALE (`/factory/save`,
   *                 provider-key save, commit-save, pipeline load). No notices
   *                 were raised, so the caller owns emitting a snapshot span.
   *
   * Required rather than defaulted because both plausible defaults are wrong:
   * defaulting to `'deltas'` silently loses the projection on every wholesale
   * save (the bug this exists to prevent), and defaulting to `'snapshot'` makes
   * every ordinary mutation re-project the entire tournament. A caller that has
   * not thought about which it is has a bug either way — so make it say.
   * `mutation-services.guard.spec.ts` asserts every call site passes one.
   */
  async saveTournamentRecords(params: {
    tournamentRecords?: Record<string, any>;
    tournamentRecord?: any;
    projectionMode: 'deltas' | 'snapshot';
    ownerEpoch?: number;
    userId?: string;
  }) {
    const tournamentRecords = this.extractTournamentRecords(params);
    // Per-tournament serialised byte size, surfaced for the load profile
    // (Stage 0). Measured by the storage layer during the write it was already
    // performing — never re-computed here.
    const bytes: Record<string, number> = {};

    for (const tournamentId of Object.keys(tournamentRecords)) {
      const result: any = await this.saveTournamentRecord({
        tournamentRecord: tournamentRecords[tournamentId],
        ownerEpoch: params.ownerEpoch,
        userId: params.userId,
      });
      if (result.error) return result;
      bytes[tournamentId] = result.bytes ?? 0;
    }

    return { ...SUCCESS, bytes };
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

    // Participation rows are keyed by tournament_id with no FK to cascade from, so they are dropped
    // here alongside the calendar detach. Unconditional: an UNLISTED record was never in a calendar
    // but still asserted participation, so gating this on the provider would strand exactly the
    // fixtures the index exists for.
    try {
      await this.participationStorage.deleteTournamentRows(tournamentId);
    } catch {
      // Fail-soft, as with the calendar and outbox side-effects: a read-model error must not block
      // the delete. The backfill job reconciles orphans.
    }

    // READ-MODEL PROJECTION: tournament deletion bypasses executionQueue (no
    // factory notice), so enqueue the delete-delta explicitly here — next to the
    // calendar detach. All child read tables (match_ups → competitors, entries,
    // tournament_venues) cascade from the tournaments row (FK ON DELETE CASCADE).
    // Flag-gated + fail-soft: an outbox error must never block the delete.
    if (this.projectionOutbox.isEnabled) {
      try {
        await this.projectionOutbox.enqueue([
          {
            tournamentId,
            op: 'delete',
            table: 'tournaments',
            key: { tournament_id: tournamentId },
            topic: 'deleteTournament',
          },
        ]);
      } catch {
        // Reconciliation/rebuild backstops a missed delete-delta.
      }
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

  /**
   * Rewrite this tournament's participation rows.
   *
   * Bounded to the one tournament, so it stays O(participants-here) however large the index grows.
   * A record asserting no durable competitor identity produces no rows, and the replace still runs:
   * that is how a tournament whose participants were removed loses its stale rows.
   *
   * Non-blocking. Participation is a derived read model — a tournament must still save when its
   * index update fails, or a read-model outage becomes a write outage.
   *
   * But non-blocking is not the same as silent, and the original comment here claimed a backfill
   * job would repair a missed update. **There is no backfill job.** The index is maintained purely
   * by this call, so a swallowed failure is a row that is missing until the tournament happens to be
   * saved again — invisible, with the read returning a plausible shorter history rather than an
   * error. That is the failure mode this whole workstream exists to stop, reintroduced at the point
   * where the guarantee is given up. So it is logged, loudly, with the id needed to repair it.
   */
  private async updateParticipationIndex(tournamentRecord: any) {
    try {
      const rows = deriveParticipationRows(tournamentRecord);
      await this.participationStorage.replaceTournamentRows(tournamentRecord.tournamentId, rows);
    } catch (error: any) {
      this.logger.error(
        `participation index not updated for ${tournamentRecord?.tournamentId}: ${error?.message ?? error}. ` +
          `The save succeeded; this tournament's participation rows are STALE until it is saved again.`,
      );
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

  /**
   * Public: list a provider's calendar tournament entries (each with
   * tournamentId + tournament.startDate/endDate). Used by the "apply
   * participant-privacy policy to existing tournaments" action to enumerate
   * and classify a provider's tournaments without loading full records.
   */
  async listProviderTournaments({ providerId }: { providerId: string }): Promise<any[]> {
    const result: any = await this.getProviderCalendar({ providerId });
    if (result?.error) return [];
    return result.tournaments ?? [];
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
