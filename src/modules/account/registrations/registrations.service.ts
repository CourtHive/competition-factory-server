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
import { sanctioningEngine, tools, tournamentEngine } from 'tods-competition-factory';

import { type RegistrationEntry } from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { AssignmentsService } from '../../factory/assignments.service';
import { AuditService } from '../../audit/audit.service';
import { CANONICAL_PERSON } from 'src/common/constants/canonicalPerson';
import { canMutateTournament } from '../../factory/helpers/checkTournamentAccess';
import { executionQueue as runExecutionQueue } from '../../factory/functions/private/executionQueue';
import { SanctioningClient, SanctioningRecordSnapshot } from '../sanctioning/sanctioning-client.service';
import { DeclarationsClient, RegistrationSnapshot } from '../declarations/declarations-client.service';
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

export interface BulkAcceptContext {
  userContext: UserContext;
  tournamentId: string;
  // Explicit ids to accept; absent → all pending (SUBMITTED/WAITLISTED) for the tournament.
  registrationIds?: string[];
  statusReason?: string;
}

export interface AcceptResult {
  registrationId: string;
  ok: boolean;
  participantId?: string;
  eventIds?: string[];
  reason?: string;
}

/**
 * Accumulates a batch of acceptances into a single mutation. Dedupes INDIVIDUALs by
 * person and PAIRs by member-set (reusing participants already in the tournamentRecord),
 * and dedupes event entries — so one `executionQueue` commits the whole batch and a
 * re-accept / both-halves-of-a-pair-selected case never duplicates.
 */
class AcceptancePlan {
  readonly individualByPerson = new Map<string, string>();
  readonly pairByInvite = new Map<string, string>();
  readonly newParticipants: any[] = [];
  /** Foreign ids to stamp onto participants that ALREADY exist in the record — an update,
   *  not a create, so it cannot ride on `addParticipants`. */
  readonly participantOtherIdStamps: { participantId: string; organisationId: string; otherParticipantId: string; uniqueOrganisationName?: string }[] = [];
  readonly stampRegistrations = new Set<string>();
  readonly handled = new Set<string>();
  private readonly pairByMembers = new Map<string, string>();
  private readonly existingEntries = new Set<string>();
  private readonly entryMap = new Map<string, Set<string>>();

  constructor(
    readonly tournamentRecord: any,
    readonly byPersonAndInvite: Map<string, RegistrationSnapshot>,
  ) {
    for (const p of tournamentRecord?.participants ?? []) {
      if (p?.participantType === 'INDIVIDUAL') {
        const canonicalId = (p.person?.personOtherIds ?? []).find((o: any) => o?.organisationId === CANONICAL_PERSON)?.personId;
        if (canonicalId) this.individualByPerson.set(canonicalId, p.participantId);
      } else if (p?.participantType === 'PAIR' && Array.isArray(p.individualParticipantIds)) {
        this.pairByMembers.set([...p.individualParticipantIds].sort().join('|'), p.participantId);
      }
    }
    for (const event of tournamentRecord?.events ?? []) {
      for (const entry of event?.entries ?? []) {
        if (entry?.participantId && event?.eventId) this.existingEntries.add(`${entry.participantId}|${event.eventId}`);
      }
    }
  }

  addEntry(eventId: string, participantId: string): void {
    if (this.existingEntries.has(`${participantId}|${eventId}`)) return; // already entered — idempotent
    if (!this.entryMap.has(eventId)) this.entryMap.set(eventId, new Set());
    this.entryMap.get(eventId)!.add(participantId);
  }

  entriesByEvent(): Array<{ eventId: string; participantIds: string[] }> {
    return [...this.entryMap.entries()].map(([eventId, ids]) => ({ eventId, participantIds: [...ids] }));
  }

  ensurePair(inviteId: string, a: string, b: string): string {
    const byInvite = this.pairByInvite.get(inviteId);
    if (byInvite) return byInvite;
    const key = [a, b].sort().join('|');
    const existing = this.pairByMembers.get(key);
    const participantId = existing ?? tools.UUID();
    if (!existing) {
      this.newParticipants.push({ participantId, participantType: 'PAIR', participantRole: 'COMPETITOR', individualParticipantIds: [a, b] });
      this.pairByMembers.set(key, participantId);
    }
    this.pairByInvite.set(inviteId, participantId);
    return participantId;
  }
}

/**
 * Does the LINKED factory expose `addParticipantOtherId`?
 *
 * It ships with factory #4620 — merged, not yet released — and CI installs the PUBLISHED
 * package, so the capability is probed rather than assumed. Queueing the method against a
 * factory that lacks it would fail the whole executionQueue, taking the accept down with
 * it; skipping is the safe degradation, because the ids still land on every participant
 * the accept CREATES (that path rides on `addParticipants` and needs no new method).
 *
 * Detected from the engine surface rather than a version string, so it self-activates on
 * the pin bump with nothing to remember to flip — same pattern as the read-model
 * conformance guards.
 */
const factoryStampsExistingParticipants = typeof (tournamentEngine as any)?.addParticipantOtherId === 'function';

/** Queue a foreign-id stamp per organisation for a participant already in the record. */
function queueForeignIdStamps(participantId: string, registration: RegistrationSnapshot | undefined, plan: AcceptancePlan): void {
  if (!factoryStampsExistingParticipants) return;
  for (const otherId of registration?.payload?.participantOtherIds ?? []) {
    if (!otherId?.organisationId || !otherId?.participantId) continue;
    plan.participantOtherIdStamps.push({
      participantId,
      organisationId: otherId.organisationId,
      otherParticipantId: otherId.participantId,
      ...(otherId.uniqueOrganisationName ? { uniqueOrganisationName: otherId.uniqueOrganisationName } : {}),
    });
  }
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
    private readonly sanctioningClient: SanctioningClient,
  ) {}

  // -------------------------------------------------------------------
  //  Director surface (Phase 2-B). CFS owns ONLY accept — it runs
  //  addParticipants (the tournamentRecord mutation) and stamps the
  //  decision in declarations. The pending list + reject/waitlist live
  //  off CFS (TMX ↔ courthive-declarations directly).
  // -------------------------------------------------------------------

  /** Accept a single registration (thin wrapper over the bulk core — a one-item batch). */
  async acceptRegistration(ctx: AdminActionContext): Promise<{ registration: RegistrationEntry; participantId: string }> {
    if (!ctx.registrationId) throw new BadRequestException('registrationId is required');
    const { results, loaded } = await this.acceptMany({
      userContext: ctx.userContext,
      tournamentId: ctx.tournamentId,
      registrationIds: [ctx.registrationId],
      statusReason: ctx.statusReason,
    });
    const result = results.find((r) => r.registrationId === ctx.registrationId);
    if (!result) throw new BadRequestException('Registration not found');
    if (!result.ok) throw new BadRequestException(result.reason ?? 'Registration could not be accepted');
    if (!result.participantId) throw new BadRequestException('Registration is already accepted');
    const reg = loaded.get(ctx.registrationId);
    const eventIds = result.eventIds ?? [];
    const eventEntries = eventIds.map((eventId) => ({ eventId, entryStatus: 'DIRECT_ACCEPTANCE' }));
    const registration = mapAcceptedRegistration(ctx, reg as any, { participantId: result.participantId, eventIds, eventEntries });
    return { registration, participantId: result.participantId };
  }

  /**
   * Bulk accept — the core accept path. Resolves every target registration into
   * participants (INDIVIDUAL + PAIR) and event entries, then commits them in ONE
   * `executionQueue` (one tournament lock, one save) instead of N. Invalid registrations
   * are pre-filtered and reported as per-item failures so partial success works without
   * losing the single-mutation win. Idempotent: an already-accepted registration, a
   * participant already present, and both halves of a pair selected together all resolve
   * to the existing participant rather than duplicating.
   */
  async acceptMany(
    ctx: BulkAcceptContext,
  ): Promise<{ results: AcceptResult[]; loaded: Map<string, RegistrationSnapshot> }> {
    await this.ensureActivated({ userContext: ctx.userContext, tournamentId: ctx.tournamentId, registrationId: '' });
    const { tournamentRecord } = await this.assertAdminAccess(ctx.userContext, ctx.tournamentId);
    const provider: string = tournamentRecord?.parentOrganisation?.organisationId ?? '';

    // Explicit ids → authoritative per-id read; no ids → all pending for the tournament.
    let targets: RegistrationSnapshot[];
    if (ctx.registrationIds?.length) {
      const fetched = await Promise.all(ctx.registrationIds.map((id) => this.declarationsClient.getRegistration(id)));
      targets = fetched.filter((r): r is RegistrationSnapshot => !!r);
    } else {
      const pending = await this.declarationsClient.listRegistrations(ctx.tournamentId, provider);
      targets = pending.filter((r) => ACCEPTABLE_ACCEPT_STATUSES.has(r.status));
    }

    // Partner lookup index — only load the full list when a target actually references a pair.
    const needsPartners = targets.some((r) => !!r.payload?.partnerInviteId);
    const all = needsPartners ? await this.declarationsClient.listRegistrations(ctx.tournamentId, provider) : targets;
    const byPersonAndInvite = new Map<string, RegistrationSnapshot>(
      all.filter((r) => r.payload?.partnerInviteId).map((r) => [`${r.personId}:${r.payload.partnerInviteId}`, r]),
    );

    const plan = new AcceptancePlan(tournamentRecord, byPersonAndInvite);
    const results: AcceptResult[] = [];
    const loaded = new Map<string, RegistrationSnapshot>();

    for (const reg of targets) {
      loaded.set(reg.declarationId, reg);
      if (plan.handled.has(reg.declarationId)) continue; // already folded in as a partner
      results.push(await this.planOne(reg, ctx, plan));
    }
    // Partners folded into a pair (and thus skipped above) still landed — report them ok.
    for (const id of plan.handled) {
      if (!results.some((r) => r.registrationId === id)) results.push({ registrationId: id, ok: true });
    }

    // Nothing to commit (all failed / all no-ops) → skip the mutation entirely.
    if (plan.newParticipants.length || plan.entriesByEvent().length) {
      const ok = await this.commitPlan(ctx, plan);
      if (!ok.success) {
        const reason = typeof ok.error === 'string' ? ok.error : JSON.stringify(ok.error);
        return { results: results.map((r) => (r.ok ? { ...r, ok: false, reason } : r)), loaded };
      }
    }

    // Stamp every registration that landed. The PARTNER_INVITE is already ACCEPTED (from
    // the invitee's confirm), so only the REGISTRATIONs transition here.
    await Promise.all(
      [...plan.stampRegistrations].map((declarationId) =>
        this.declarationsClient
          .transitionRegistration({
            declarationId,
            toStatus: 'ACCEPTED',
            transitionedBy: ctx.userContext.userId ?? 'admin',
            reason: ctx.statusReason,
          })
          .catch((err) => this.logger.warn(`accept: stamp ACCEPTED failed for ${declarationId}: ${err?.message ?? err}`)),
      ),
    );

    return { results, loaded };
  }

  /** Resolve one registration into the shared plan (participants + entries + stamps). */
  private async planOne(reg: RegistrationSnapshot, ctx: BulkAcceptContext, plan: AcceptancePlan): Promise<AcceptResult> {
    const registrationId = reg.declarationId;
    if (reg.tournamentId && reg.tournamentId !== ctx.tournamentId) {
      return { registrationId, ok: false, reason: 'Registration does not belong to this tournament' };
    }
    if (reg.status === 'ACCEPTED') return { registrationId, ok: true }; // idempotent no-op
    if (!ACCEPTABLE_ACCEPT_STATUSES.has(reg.status)) {
      return { registrationId, ok: false, reason: `Registration is not acceptable in state: ${reg.status}` };
    }

    const participantId = await this.ensureIndividual(reg.personId, reg, plan);
    if (!participantId) {
      return { registrationId, ok: false, reason: 'Applicant has no canonical name — ask them to complete their HiveID profile' };
    }

    const resolved = resolveAcceptedEventIds(plan.tournamentRecord, reg.payload?.eventIds);
    if (resolved.dropped.length) {
      this.logger.warn(
        `accept: dropped ${resolved.dropped.length} unresolved event(s) [${resolved.dropped.join(', ')}] for registration ${registrationId} on tournament ${ctx.tournamentId}`,
      );
    }

    const pairEventId = await this.planPair(reg, participantId, plan);

    // The individual enters every resolved event EXCEPT the one accepted as a pair.
    const eventIds = resolved.eventIds.filter((id) => id !== pairEventId);
    for (const eventId of eventIds) plan.addEntry(eventId, participantId);
    plan.stampRegistrations.add(registrationId);

    const enteredEvents = pairEventId ? [...eventIds, pairEventId] : eventIds;
    return { registrationId, ok: true, participantId, eventIds: enteredEvents };
  }

  /**
   * If the registration references a complete PARTNER_INVITE, build the PAIR (both
   * INDIVIDUALs, reused where present) + enter it into the pair event, and mark the
   * partner's registration for stamping. Returns the pair's activated eventId (so the
   * individual doesn't also enter it), or null when there is no complete pair.
   */
  private async planPair(reg: RegistrationSnapshot, participantId: string, plan: AcceptancePlan): Promise<string | null> {
    const inviteId = reg.payload?.partnerInviteId;
    if (!inviteId) return null;
    const status = await this.declarationsClient.getPairStatus(inviteId);
    if (!status?.complete || !status.nominatorPersonId || !status.inviteePersonId) return null;

    const partnerPersonId = status.nominatorPersonId === reg.personId ? status.inviteePersonId : status.nominatorPersonId;
    const partnerReg = plan.byPersonAndInvite.get(`${partnerPersonId}:${inviteId}`);
    const partnerParticipantId = await this.ensureIndividual(partnerPersonId, partnerReg, plan);
    if (!partnerParticipantId) return null; // partner has no canonical name → can't form the pair

    const pairParticipantId = plan.ensurePair(inviteId, participantId, partnerParticipantId);
    const pairEventId = resolveAcceptedEventIds(plan.tournamentRecord, [status.eventId, status.event].filter(Boolean) as string[]).eventIds[0] ?? null;
    if (pairEventId) plan.addEntry(pairEventId, pairParticipantId);

    // Accepting a complete pair accepts BOTH people; stamp the partner's registration too.
    if (partnerReg) {
      plan.stampRegistrations.add(partnerReg.declarationId);
      plan.handled.add(partnerReg.declarationId);
    }
    return pairEventId;
  }

  /** Resolve (or reuse) a person's INDIVIDUAL participant; null when they have no canonical name. */
  /**
   * Resolve the participantId for a person, in strict precedence:
   *
   *   1. a participant ALREADY in the tournamentRecord for this person (seeded into
   *      `individualByPerson` from their CANONICAL_PERSON personOtherIds entry) — never
   *      create a second participant for someone already entered;
   *   2. the participantId **reserved at registration** by courthive-declarations;
   *   3. mint.
   *
   * Step 2 is what makes the identity predate every record. An id minted here is an
   * artifact of whichever engine ran first, so two records holding the same participation
   * would disagree; an id reserved at registration is authored upstream of both, which is
   * what lets a forwarded mutation replay verbatim elsewhere rather than needing an
   * id-translation table.
   *
   * Step 3 must remain: walk-ins and director-added participants never pass through
   * registration, and registrations predating declarations migration 0004 carry no id.
   */
  private async ensureIndividual(
    personId: string,
    registration: RegistrationSnapshot | undefined,
    plan: AcceptancePlan,
  ): Promise<string | null> {
    const cached = plan.individualByPerson.get(personId);
    if (cached) {
      // Already in the record. A foreign sanctioning body's ids still have to reach this
      // participant — otherwise a person accepted earlier by a self-registration would be
      // permanently unaddressable back to the body that later registered them.
      queueForeignIdStamps(cached, registration, plan);
      return cached;
    }

    const applicant = registration?.payload?.applicant;
    const canonical = await this.personsClient.getById(personId).catch(() => null);
    const givenName = canonical?.person?.standardGivenName ?? applicant?.givenName ?? '';
    const familyName = canonical?.person?.standardFamilyName ?? applicant?.familyName ?? '';
    if (!givenName || !familyName) return null;

    const participantId = registration?.participantId ?? tools.UUID();
    // F2b — a registration that originated with an OUTSIDE sanctioning body carries that
    // body's own id for this competitor. Stamp it so results can later be addressed back
    // to the system that registered them; `personOtherIds` below cannot serve that for a
    // PAIR or TEAM, which have no `person` at all.
    //
    // Creation-time only. Stamping a participant ALREADY in the record would be an update,
    // which needs factory `addParticipantOtherId` — merged but unreleased — so that path
    // waits for the pin. Omitted rather than set to [] so a self-registration carries no
    // empty array into the record.
    const participantOtherIds = registration?.payload?.participantOtherIds;
    plan.newParticipants.push({
      participantId,
      participantType: 'INDIVIDUAL',
      participantRole: 'COMPETITOR',
      participantName: `${givenName} ${familyName}`,
      ...(participantOtherIds?.length ? { participantOtherIds } : {}),
      person: {
        standardGivenName: givenName,
        standardFamilyName: familyName,
        birthDate: canonical?.person?.birthDate ?? null,
        sex: canonical?.person?.sex ?? null,
        nationalityCode: canonical?.person?.nationalityCode ?? null,
        personOtherIds: personId
          ? [{ organisationId: CANONICAL_PERSON, personId, createdAt: new Date().toISOString() }]
          : [],
      },
    });
    plan.individualByPerson.set(personId, participantId);
    return participantId;
  }

  /** Run the batched addParticipants + addEventEntries in a single executionQueue. */
  private async commitPlan(ctx: BulkAcceptContext, plan: AcceptancePlan): Promise<{ success: boolean; error?: any }> {
    const methods: any[] = [];
    if (plan.newParticipants.length) {
      methods.push({ method: 'addParticipants', params: { tournamentId: ctx.tournamentId, participants: plan.newParticipants } });
    }
    for (const { eventId, participantIds } of plan.entriesByEvent()) {
      methods.push({ method: 'addEventEntries', params: { eventId, participantIds, entryStatus: 'DIRECT_ACCEPTANCE' } });
    }
    for (const stamp of plan.participantOtherIdStamps) {
      methods.push({ method: 'addParticipantOtherId', params: { tournamentId: ctx.tournamentId, ...stamp } });
    }
    const result: any = await runExecutionQueue(
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
    return result?.success ? { success: true } : { success: false, error: result?.error ?? 'addParticipants failed' };
  }

  // -------------------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------------------

  /**
   * Lazy-activate a sanctioning-originated tournament on first accept: if the
   * tournamentRecord does not exist yet, pull the approved proposal from AMS
   * (service token), run the factory `activateFromSanctioning` (reusing the
   * pre-assigned tournamentId + stable eventIds), and persist it. Idempotent —
   * an existing record short-circuits. Absent proposal → no-op (assertAdminAccess
   * then surfaces the "Tournament not found" 404).
   */
  private async ensureActivated(ctx: AdminActionContext): Promise<void> {
    if (!ctx.userContext) throw new UnauthorizedException();
    if (!ctx.tournamentId) throw new BadRequestException('tournamentId is required');

    const existing = await this.tournamentStorageService.findTournamentRecord({ tournamentId: ctx.tournamentId });
    if (existing?.tournamentRecord) return;

    const sanctioningRecord = await this.sanctioningClient.getRecordByTournamentId(ctx.tournamentId);
    if (!sanctioningRecord) return; // nothing to activate from — let assertAdminAccess 404

    // Activation is authorized against the proposal's provider (the tournamentRecord
    // doesn't exist yet, so canMutateTournament can't gate it).
    const provider = sanctioningRecord.governingBody?.organisationId ?? sanctioningRecord.governingBodyId ?? '';
    if (!canActivateForProvider(ctx.userContext, provider)) {
      throw new ForbiddenException('Not authorised to activate this tournament');
    }

    const activated = activateSanctioning(sanctioningRecord);
    if (!activated?.tournamentRecord) {
      throw new BadRequestException(
        `Could not activate tournament from sanctioning record: ${activated?.error ?? 'unknown error'}`,
      );
    }

    const saveResult: any = await this.tournamentStorageService.saveTournamentRecord({
      tournamentRecord: activated.tournamentRecord,
      userId: ctx.userContext.userId,
    });
    if (saveResult?.error) {
      throw new BadRequestException(`Failed to persist activated tournament: ${saveResult.error}`);
    }
    this.logger.log(
      `lazy-activated tournamentRecord ${ctx.tournamentId} from sanctioning ${sanctioningRecord.sanctioningId} on first accept`,
    );
  }

  private async assertAdminAccess(
    userContext: UserContext | undefined,
    tournamentId: string,
  ): Promise<{ tournamentRecord: any }> {
    if (!userContext) throw new UnauthorizedException();
    if (!tournamentId) throw new BadRequestException('tournamentId is required');
    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) throw new BadRequestException('Tournament not found');
    const assignedRoles = await this.assignmentsService.getAssignedRoles(userContext.userId);
    if (!canMutateTournament(tournamentRecord, userContext, assignedRoles)) {
      throw new ForbiddenException('Not authorised to manage registrations for this tournament');
    }
    return { tournamentRecord };
  }
}

// Authorize lazy-activation against the proposal's provider (super-admin, a direct
// provider role, or a provisioner-managed provider). Mirrors the provider dimension
// of canMutateTournament, since no tournamentRecord exists yet to gate against.
function canActivateForProvider(userContext: UserContext, provider: string): boolean {
  if (userContext.isSuperAdmin) return true;
  if (!provider) return false;
  if (userContext.providerIds?.includes(provider)) return true;
  return !!userContext.provisionerProviderIds?.includes(provider);
}

// Run the factory `activateFromSanctioning` via the sanctioningEngine. The engine is a
// module-level singleton (not per-request isolated like the tournament mutation engine),
// so the reset→setState→activate→reset sequence is kept strictly SYNCHRONOUS — no awaits —
// making it atomic under Node's single thread. Callers await the fetch/save AROUND it.
function activateSanctioning(sanctioningRecord: SanctioningRecordSnapshot): { tournamentRecord?: any; error?: any } {
  const engine = sanctioningEngine as any;
  engine.reset();
  engine.setState({ [sanctioningRecord.sanctioningId]: sanctioningRecord });
  engine.setActiveSanctioningId(sanctioningRecord.sanctioningId);
  const result = engine.activateFromSanctioning({});
  engine.reset();
  return result ?? {};
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
