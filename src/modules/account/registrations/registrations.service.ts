/**
 * RegistrationsService — both halves of the HiveID registration loop.
 *
 *   Phase 2-A (applicant-side, audience: hiveid):
 *     - apply         — POST  /me/registrations
 *     - listForUser   — GET   /me/registrations
 *     - withdraw      — DELETE /me/registrations/:registrationId
 *
 *   Phase 2-B (director-side, audience: admin, gated by canMutateTournament):
 *     - listForTournament  — GET  /admin/tournaments/:tid/registrations
 *     - acceptRegistration — POST /admin/tournaments/:tid/registrations/:rid/accept
 *     - waitlistRegistration — POST .../waitlist
 *     - rejectRegistration   — POST .../reject
 *     - bulkAction           — POST .../bulk
 *
 * The accept handler is server-orchestrated: it runs `addParticipants`
 * (and per-event `addEventEntries`) through the existing
 * `executionQueue` server-side, pre-stamping the HiveID canonical
 * `personId` on `Person.personOtherIds[]` so the participations
 * endpoint surfaces the new Participant immediately. After the
 * factory mutations succeed, the RegistrationEntry's status flips to
 * `accepted` and the `participantId` is linked.
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  REGISTRATION_ENTRY_STORAGE,
  type IRegistrationEntryStorage,
  type RegistrationEntry,
  type RegistrationStatus,
  USER_STORAGE,
  type IUserStorage,
} from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { AssignmentsService } from '../../factory/assignments.service';
import { AuditService } from '../../audit/audit.service';
import { CANONICAL_PERSON } from '../auth/hiveid.constants';
import { canMutateTournament } from '../../factory/helpers/checkTournamentAccess';
import { executionQueue as runExecutionQueue } from '../../factory/functions/private/executionQueue';
import type { UserContext } from '../auth/decorators/user-context.decorator';

export interface ApplyForTournamentInput {
  userId: string;
  tournamentId: string;
  eventIds?: string[];
  partnerUserId?: string | null;
  answers?: Record<string, unknown>;
}

export interface AdminActionContext {
  userContext: UserContext;
  tournamentId: string;
  registrationId: string;
  statusReason?: string;
}

export interface BulkAdminAction {
  userContext: UserContext;
  tournamentId: string;
  registrationIds: string[];
  action: 'accept' | 'waitlist' | 'reject';
  statusReason?: string;
}

/**
 * Director list payload — the storage entry enriched with the
 * applicant's cached canonical name + login email so the TMX table
 * can render a useful row without a follow-on lookup.
 */
export type AdminRegistrationRow = RegistrationEntry & {
  applicantGivenName: string | null;
  applicantFamilyName: string | null;
  applicantEmail: string | null;
};

@Injectable()
export class RegistrationsService {
  constructor(
    @Inject(REGISTRATION_ENTRY_STORAGE)
    private readonly storage: IRegistrationEntryStorage,
    @Inject(USER_STORAGE)
    private readonly userStorage: IUserStorage,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------
  //  Applicant surface (Phase 2-A) — see file header for HTTP routes.
  // -------------------------------------------------------------------

  async apply(input: ApplyForTournamentInput): Promise<RegistrationEntry> {
    if (!input.userId) throw new UnauthorizedException();
    if (!input.tournamentId) throw new BadRequestException('tournamentId is required');

    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({
      tournamentId: input.tournamentId,
    });
    if (!tournamentRecord) throw new BadRequestException('Tournament not found');
    const profile: any = (tournamentRecord as any).registrationProfile;
    if (!profile || !profile.entriesOpen) {
      throw new BadRequestException('This tournament does not have a published registration window');
    }
    const now = new Date();
    if (profile.entriesClose && new Date(profile.entriesClose) < now) {
      throw new BadRequestException('Entries for this tournament are closed');
    }
    if (profile.entriesOpen && new Date(profile.entriesOpen) > now) {
      throw new BadRequestException('Entries for this tournament have not opened yet');
    }

    const link = await this.userStorage.getPersonLink(input.userId);

    const validatedEventIds = filterValidEventIds(tournamentRecord, input.eventIds);

    return this.storage.applyForTournament({
      tournamentId: input.tournamentId,
      userId: input.userId,
      personId: link?.personId ?? null,
      eventIds: validatedEventIds,
      partnerUserId: input.partnerUserId ?? null,
      answers: input.answers ?? {},
    });
  }

  async listForUser(userId: string): Promise<RegistrationEntry[]> {
    if (!userId) throw new UnauthorizedException();
    return this.storage.listByUser(userId);
  }

  async withdraw(userId: string, registrationId: string): Promise<RegistrationEntry> {
    if (!userId) throw new UnauthorizedException();
    if (!registrationId) throw new BadRequestException('registrationId is required');
    const existing = await this.storage.findById(registrationId);
    if (!existing) throw new BadRequestException('Registration not found');
    if (existing.userId !== userId) {
      throw new ForbiddenException('You can only withdraw your own registrations');
    }
    if (existing.status === 'withdrawn' || existing.status === 'rejected') {
      return existing;
    }
    const updated = await this.storage.updateStatus({
      registrationId,
      status: 'withdrawn',
      decidedByUserId: userId,
      statusReason: 'applicant-initiated',
    });
    if (!updated) throw new BadRequestException('Withdraw failed');
    return updated;
  }

  // -------------------------------------------------------------------
  //  Director surface (Phase 2-B). All admin paths flow through
  //  `assertAdminAccess` which loads the tournament record once and
  //  threads it to the action handler — saves a second storage hit.
  // -------------------------------------------------------------------

  async listForTournament(
    userContext: UserContext,
    tournamentId: string,
    statusFilter?: RegistrationStatus,
  ): Promise<AdminRegistrationRow[]> {
    await this.assertAdminAccess(userContext, tournamentId);
    const rows = await this.storage.listByTournament(tournamentId);
    const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

    // Enrich with cached canonical name + email by joining against
    // `users`. N+1 over distinct userIds — fine for the typical
    // tournament size (< 200 applicants).
    const uniqueUserIds = Array.from(new Set(filtered.map((r) => r.userId)));
    const userById = new Map<string, any>();
    await Promise.all(
      uniqueUserIds.map(async (userId) => {
        try {
          const user = await this.userStorage.findByUserId(userId);
          if (user) userById.set(userId, user);
        } catch {
          /* keep going — missing user becomes an "(unknown)" applicant in the UI */
        }
      }),
    );
    const linkById = new Map<string, any>();
    await Promise.all(
      uniqueUserIds.map(async (userId) => {
        try {
          const link = await this.userStorage.getPersonLink(userId);
          if (link) linkById.set(userId, link);
        } catch {
          /* same */
        }
      }),
    );

    return filtered.map((r) => {
      const link = linkById.get(r.userId);
      const user = userById.get(r.userId);
      return {
        ...r,
        applicantGivenName:
          link?.cached?.standardGivenName ?? user?.firstName ?? null,
        applicantFamilyName:
          link?.cached?.standardFamilyName ?? user?.lastName ?? null,
        applicantEmail: user?.email ?? null,
      } as AdminRegistrationRow;
    });
  }

  async acceptRegistration(ctx: AdminActionContext): Promise<{ registration: RegistrationEntry; participantId: string }> {
    const { tournamentRecord } = await this.assertAdminAccess(ctx.userContext, ctx.tournamentId);
    const entry = await this.loadActionableEntry(ctx.tournamentId, ctx.registrationId, ['applied', 'waitlisted']);
    const applicantLink = await this.userStorage.getPersonLink(entry.userId);
    const applicantUser = await this.userStorage.findByUserId(entry.userId);
    if (!applicantUser) throw new BadRequestException('Applicant user not found');

    const givenName = applicantLink?.cached.standardGivenName ?? applicantUser.firstName ?? '';
    const familyName = applicantLink?.cached.standardFamilyName ?? applicantUser.lastName ?? '';
    if (!givenName || !familyName) {
      throw new BadRequestException('Applicant has no canonical name — ask them to complete their HiveID profile');
    }

    const participantId = randomUUID();
    const validEvents = filterValidEventIds(tournamentRecord, entry.eventIds);

    const personOtherIds = applicantLink?.personId
      ? [{ organisationId: CANONICAL_PERSON, personId: applicantLink.personId, createdAt: new Date().toISOString() }]
      : [];

    const participant: any = {
      participantId,
      participantType: 'INDIVIDUAL',
      participantName: `${givenName} ${familyName}`,
      person: {
        standardGivenName: givenName,
        standardFamilyName: familyName,
        birthDate: applicantLink?.cached.birthDate ?? null,
        sex: applicantLink?.cached.sex ?? null,
        nationalityCode: applicantLink?.cached.nationalityCode ?? null,
        personOtherIds,
      },
    };

    const methods: any[] = [
      { method: 'addParticipants', params: { tournamentId: ctx.tournamentId, participants: [participant] } },
    ];
    for (const eventId of validEvents) {
      methods.push({
        method: 'addEventEntries',
        params: {
          eventId,
          participantIds: [participantId],
          entryStatus: 'DIRECT_ACCEPTANCE',
        },
      });
    }

    const result = await runExecutionQueue(
      {
        tournamentIds: [ctx.tournamentId],
        methods,
        userId: ctx.userContext.userId,
        userEmail: ctx.userContext.email,
        source: 'hiveid-acceptance',
      },
      undefined,
      this.tournamentStorageService,
      this.auditService,
    );
    if (!(result as any)?.success) {
      const err = (result as any)?.error ?? 'addParticipants failed';
      throw new BadRequestException(typeof err === 'string' ? err : JSON.stringify(err));
    }

    const eventEntries = validEvents.map((eventId) => ({
      eventId,
      entryStatus: 'DIRECT_ACCEPTANCE',
    }));

    const updated = await this.storage.linkParticipant({
      registrationId: ctx.registrationId,
      participantId,
      eventEntries,
      decidedByUserId: ctx.userContext.userId,
      statusReason: ctx.statusReason ?? null,
    });
    if (!updated) throw new BadRequestException('Could not record acceptance — tournament mutation succeeded but status update failed');
    return { registration: updated, participantId };
  }

  async waitlistRegistration(ctx: AdminActionContext): Promise<RegistrationEntry> {
    await this.assertAdminAccess(ctx.userContext, ctx.tournamentId);
    await this.loadActionableEntry(ctx.tournamentId, ctx.registrationId, ['applied', 'accepted', 'seeded']);
    const updated = await this.storage.updateStatus({
      registrationId: ctx.registrationId,
      status: 'waitlisted',
      decidedByUserId: ctx.userContext.userId,
      statusReason: ctx.statusReason ?? null,
    });
    if (!updated) throw new BadRequestException('Could not update registration status');
    return updated;
  }

  async rejectRegistration(ctx: AdminActionContext): Promise<RegistrationEntry> {
    await this.assertAdminAccess(ctx.userContext, ctx.tournamentId);
    await this.loadActionableEntry(ctx.tournamentId, ctx.registrationId, ['applied', 'waitlisted']);
    const updated = await this.storage.updateStatus({
      registrationId: ctx.registrationId,
      status: 'rejected',
      decidedByUserId: ctx.userContext.userId,
      statusReason: ctx.statusReason ?? null,
    });
    if (!updated) throw new BadRequestException('Could not update registration status');
    return updated;
  }

  async bulkAction(ctx: BulkAdminAction): Promise<{ results: Array<{ registrationId: string; ok: boolean; error?: string; participantId?: string }> }> {
    await this.assertAdminAccess(ctx.userContext, ctx.tournamentId);
    const results: Array<{ registrationId: string; ok: boolean; error?: string; participantId?: string }> = [];
    for (const registrationId of ctx.registrationIds) {
      try {
        if (ctx.action === 'accept') {
          const r = await this.acceptRegistration({
            userContext: ctx.userContext,
            tournamentId: ctx.tournamentId,
            registrationId,
            statusReason: ctx.statusReason,
          });
          results.push({ registrationId, ok: true, participantId: r.participantId });
        } else if (ctx.action === 'waitlist') {
          await this.waitlistRegistration({
            userContext: ctx.userContext,
            tournamentId: ctx.tournamentId,
            registrationId,
            statusReason: ctx.statusReason,
          });
          results.push({ registrationId, ok: true });
        } else {
          await this.rejectRegistration({
            userContext: ctx.userContext,
            tournamentId: ctx.tournamentId,
            registrationId,
            statusReason: ctx.statusReason,
          });
          results.push({ registrationId, ok: true });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ registrationId, ok: false, error: message });
      }
    }
    return { results };
  }

  // -------------------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------------------

  private async assertAdminAccess(
    userContext: UserContext | undefined,
    tournamentId: string,
  ): Promise<{ tournamentRecord: any }> {
    if (!userContext) throw new UnauthorizedException();
    if (!tournamentId) throw new BadRequestException('tournamentId is required');
    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) throw new BadRequestException('Tournament not found');
    const assignedTournamentIds = await this.assignmentsService.getAssignedTournamentIds(userContext.userId);
    if (!canMutateTournament(tournamentRecord, userContext, assignedTournamentIds)) {
      throw new ForbiddenException('Not authorised to manage registrations for this tournament');
    }
    return { tournamentRecord };
  }

  private async loadActionableEntry(
    tournamentId: string,
    registrationId: string,
    allowedStatuses: RegistrationStatus[],
  ): Promise<RegistrationEntry> {
    if (!registrationId) throw new BadRequestException('registrationId is required');
    const entry = await this.storage.findById(registrationId);
    if (!entry) throw new BadRequestException('Registration not found');
    if (entry.tournamentId !== tournamentId) {
      throw new BadRequestException('Registration does not belong to this tournament');
    }
    if (!allowedStatuses.includes(entry.status)) {
      throw new BadRequestException(`Registration is in terminal state: ${entry.status}`);
    }
    return entry;
  }
}

function filterValidEventIds(tournamentRecord: any, requested?: string[]): string[] {
  if (!requested?.length) return [];
  const validIds = new Set<string>();
  for (const event of tournamentRecord?.events ?? []) {
    if (event?.eventId) validIds.add(event.eventId);
  }
  return requested.filter((id) => typeof id === 'string' && validIds.has(id));
}
