/**
 * RegistrationsService — the director-side accept surface of the HiveID
 * registration loop (audience: admin, gated by canMutateTournament):
 *
 *     - acceptRegistration — POST /admin/tournaments/:tid/registrations/:rid/accept
 *
 * Pending registrations live off the mutation server (courthive-declarations) —
 * the public applicant surface (apply / list / withdraw) was retired once
 * courthive-public moved its submit + existing-check onto the declarations
 * client. ACCEPT is the only action here: it reads the applicant from
 * declarations, runs `addParticipants` (+ per-event `addEventEntries`) through the
 * existing `executionQueue`, stamps the HiveID canonical `personId` on
 * `Person.personOtherIds[]`, then marks the declaration ACCEPTED. The pending list
 * + reject/waitlist go TMX ↔ declarations directly.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { type RegistrationEntry } from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { AssignmentsService } from '../../factory/assignments.service';
import { AuditService } from '../../audit/audit.service';
import { CANONICAL_PERSON } from '../auth/hiveid.constants';
import { canMutateTournament } from '../../factory/helpers/checkTournamentAccess';
import { executionQueue as runExecutionQueue } from '../../factory/functions/private/executionQueue';
import { DeclarationsClient } from '../declarations/declarations-client.service';
import { PersonsClient } from '../persons/persons-client.service';
import type { UserContext } from '../auth/decorators/user-context.decorator';

// Declaration statuses (courthive-declarations) a registration may be accepted
// from. Kept as literals CFS-side; the declarations service owns the vocabulary.
const ACCEPTABLE_ACCEPT_STATUSES = new Set(['SUBMITTED', 'WAITLISTED']);

export interface AdminActionContext {
  userContext: UserContext;
  tournamentId: string;
  registrationId: string;
  statusReason?: string;
}

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
    private readonly auditService: AuditService,
    private readonly declarationsClient: DeclarationsClient,
    private readonly personsClient: PersonsClient,
  ) {}

  // -------------------------------------------------------------------
  //  Director surface (Phase 2-B). CFS owns ONLY accept — it runs
  //  addParticipants (the tournamentRecord mutation) and stamps the
  //  decision in declarations. The pending list + reject/waitlist live
  //  off CFS (TMX ↔ courthive-declarations directly).
  // -------------------------------------------------------------------

  async acceptRegistration(ctx: AdminActionContext): Promise<{ registration: RegistrationEntry; participantId: string }> {
    const { tournamentRecord } = await this.assertAdminAccess(ctx.userContext, ctx.tournamentId);
    if (!ctx.registrationId) throw new BadRequestException('registrationId is required');

    // Pending registrations live OFF CFS — read the applicant authoritatively from
    // the declarations service. Accept is the ONLY CFS touch: addParticipants on the
    // (already-activated) tournamentRecord, then stamp ACCEPTED back in declarations.
    const reg = await this.declarationsClient.getRegistration(ctx.registrationId);
    if (!reg) throw new BadRequestException('Registration not found');
    if (reg.tournamentId && reg.tournamentId !== ctx.tournamentId) {
      throw new BadRequestException('Registration does not belong to this tournament');
    }
    if (!ACCEPTABLE_ACCEPT_STATUSES.has(reg.status)) {
      throw new BadRequestException(`Registration is not acceptable in state: ${reg.status}`);
    }

    // Canonical fields from persons (dob/sex/nationality); name falls back to the
    // denormalized applicant name carried on the registration.
    const canonical = await this.personsClient.getById(reg.personId).catch(() => null);
    const applicant: any = (reg.payload as any)?.applicant ?? {};
    const givenName = canonical?.person?.standardGivenName ?? applicant.givenName ?? '';
    const familyName = canonical?.person?.standardFamilyName ?? applicant.familyName ?? '';
    if (!givenName || !familyName) {
      throw new BadRequestException('Applicant has no canonical name — ask them to complete their HiveID profile');
    }

    const participantId = randomUUID();
    const personOtherIds = reg.personId
      ? [{ organisationId: CANONICAL_PERSON, personId: reg.personId, createdAt: new Date().toISOString() }]
      : [];
    const participant: any = {
      participantId,
      participantType: 'INDIVIDUAL',
      participantName: `${givenName} ${familyName}`,
      person: {
        standardGivenName: givenName,
        standardFamilyName: familyName,
        birthDate: canonical?.person?.birthDate ?? null,
        sex: canonical?.person?.sex ?? null,
        nationalityCode: canonical?.person?.nationalityCode ?? null,
        personOtherIds,
      },
    };

    // Registrations reference events by stable eventId (id-join); legacy rows may carry
    // event NAMES — both resolve. Anything matching neither is dropped and warned (never
    // silently swallowed) so a proposal/registration event mismatch is observable.
    const { eventIds, dropped } = resolveAcceptedEventIds(tournamentRecord, (reg.payload as any)?.eventIds);
    if (dropped.length) {
      this.logger.warn(
        `acceptRegistration: dropped ${dropped.length} unresolved event(s) [${dropped.join(', ')}] for registration ${ctx.registrationId} on tournament ${ctx.tournamentId}`,
      );
    }
    const methods: any[] = [
      { method: 'addParticipants', params: { tournamentId: ctx.tournamentId, participants: [participant] } },
    ];
    for (const eventId of eventIds) {
      methods.push({
        method: 'addEventEntries',
        params: { eventId, participantIds: [participantId], entryStatus: 'DIRECT_ACCEPTANCE' },
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

    const stamped = await this.declarationsClient.transitionRegistration({
      declarationId: ctx.registrationId,
      toStatus: 'ACCEPTED',
      transitionedBy: ctx.userContext.userId ?? 'admin',
      reason: ctx.statusReason,
    });
    if (!stamped) {
      throw new BadRequestException(
        'Could not record acceptance — the tournament mutation succeeded but the declarations stamp failed',
      );
    }

    const eventEntries = eventIds.map((eventId) => ({ eventId, entryStatus: 'DIRECT_ACCEPTANCE' }));
    const registration = mapAcceptedRegistration(ctx, reg, { participantId, eventIds, eventEntries });
    return { registration, participantId };
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
}

// Map a declarations registration's `eventIds` onto the activated tournamentRecord's
// eventIds. Registrations now carry the stable eventId (id-join); legacy rows may carry
// event NAMES — both resolve. Entries matching neither are returned in `dropped` (the
// caller warns) rather than silently swallowed; resolved result is de-duped.
function resolveAcceptedEventIds(
  tournamentRecord: any,
  requested?: string[],
): { eventIds: string[]; dropped: string[] } {
  if (!requested?.length) return { eventIds: [], dropped: [] };
  const byId = new Set<string>();
  const nameToId = new Map<string, string>();
  for (const event of tournamentRecord?.events ?? []) {
    if (!event?.eventId) continue;
    byId.add(event.eventId);
    if (event?.eventName) nameToId.set(event.eventName, event.eventId);
  }
  const out: string[] = [];
  const dropped: string[] = [];
  for (const r of requested) {
    if (typeof r !== 'string') continue;
    if (byId.has(r)) out.push(r);
    else if (nameToId.has(r)) out.push(nameToId.get(r) as string);
    else dropped.push(r);
  }
  return { eventIds: [...new Set(out)], dropped };
}

// Shape a director-facing RegistrationEntry from a declarations snapshot after an
// accept. Off-CFS registrations are person-keyed, so there is no CFS `userId`.
function mapAcceptedRegistration(
  ctx: AdminActionContext,
  reg: { personId: string; payload: any; updatedAt: string },
  extra: { participantId: string; eventIds: string[]; eventEntries: Array<{ eventId: string; entryStatus?: string }> },
): RegistrationEntry {
  const now = new Date().toISOString();
  return {
    registrationId: ctx.registrationId,
    tournamentId: ctx.tournamentId,
    userId: '',
    personId: reg.personId ?? null,
    eventIds: extra.eventIds,
    partnerUserId: null,
    answers: (reg.payload as any)?.answers ?? {},
    status: 'accepted',
    statusReason: ctx.statusReason ?? null,
    appliedAt: reg.updatedAt ?? now,
    statusAt: now,
    decidedByUserId: ctx.userContext.userId ?? null,
    participantId: extra.participantId,
    eventEntries: extra.eventEntries,
    createdAt: reg.updatedAt ?? now,
    updatedAt: now,
  };
}
