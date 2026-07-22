/**
 * HiveIDTournamentService — the SPLIT (tournament-entangled) half of the former
 * account/auth/HiveIDService, extracted so it survives the Phase-3 drop of the
 * MOVE account tree. These three methods read CFS tournament records (which the
 * IdP does not have), so they STAY on CFS even after `/auth/*` flips to the IdP;
 * the nginx cutover pins `me/participations`, `me/claimable/:tid`, `me/claim`
 * back to CFS (ACCOUNT_MOVE_PHASE3_EXECUTION_PLAN.md §B).
 *
 * Verify-only + neutral deps only (USER_STORAGE, TournamentStorageService,
 * AuditService, the factory executionQueue, the neutral CANONICAL_PERSON) — no
 * import from the account MOVE tree.
 */
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { executionQueue as runExecutionQueue } from 'src/modules/factory/functions/private/executionQueue';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { CANONICAL_PERSON } from 'src/common/constants/canonicalPerson';
import { AuditService } from 'src/modules/audit/audit.service';

export interface ParticipationRow {
  tournamentId: string;
  tournamentName: string;
  startDate: string | null;
  endDate: string | null;
  participantId: string;
  participantName: string;
  eventCount: number;
}

export interface ClaimableCandidate {
  participantId: string;
  participantName: string;
  sex: string | null;
  nationalityCode: string | null;
  birthDate: string | null;
  alreadyLinkedTo: string | null;
}

function normalizeName(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function isIndividualParticipant(participant: any): boolean {
  return (participant?.participantType ?? 'INDIVIDUAL') === 'INDIVIDUAL';
}

function extractCanonicalPersonId(participant: any): string | null {
  const otherIds = participant?.person?.personOtherIds ?? [];
  const hit = otherIds.find((o: any) => o?.organisationId === CANONICAL_PERSON);
  return hit?.personId ?? null;
}

function participantMatchesPerson(participant: any, personId: string): boolean {
  return extractCanonicalPersonId(participant) === personId;
}

function countParticipantEvents(tournament: any, participantId: string): number {
  const events: any[] = tournament?.events ?? [];
  return events.filter((event) => (event?.entries ?? []).some((e: any) => e?.participantId === participantId)).length;
}

function byStartDateDesc(a: ParticipationRow, b: ParticipationRow): number {
  const aDate = a.startDate ?? '';
  const bDate = b.startDate ?? '';
  if (aDate === bDate) return a.tournamentName.localeCompare(b.tournamentName);
  return aDate < bDate ? 1 : -1;
}

@Injectable()
export class HiveIDTournamentService {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly auditService: AuditService,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
  ) {}

  /**
   * GET /auth/hiveid/me/participations — surface all tournaments where
   * the caller has been claimed as a Participant via the CANONICAL_PERSON
   * organisationId. Scans every tournament record server-side; acceptable
   * for early adoption (handful of HiveID users) and trivially cacheable
   * later when volume grows.
   */
  async getMyParticipations(userId: string): Promise<{
    personId: string | null;
    participations: ParticipationRow[];
  }> {
    if (!userId) throw new UnauthorizedException();
    const link = await this.userStorage.getPersonLink(userId);
    const personId = link?.personId ?? null;
    if (!personId) return { personId: null, participations: [] };

    const tournamentIds = await this.tournamentStorageService.listTournamentIds();
    if (!tournamentIds.length) return { personId, participations: [] };

    const { tournamentRecords } = (await this.tournamentStorageService.fetchTournamentRecords({
      tournamentIds,
    })) as { tournamentRecords?: Record<string, any> };
    if (!tournamentRecords) return { personId, participations: [] };

    const out: ParticipationRow[] = [];
    for (const tournament of Object.values(tournamentRecords)) {
      const tid = tournament?.tournamentId;
      if (!tid) continue;
      const participants: any[] = tournament?.participants ?? [];
      for (const participant of participants) {
        if (!participantMatchesPerson(participant, personId)) continue;
        out.push({
          tournamentId: tid,
          tournamentName: tournament.tournamentName ?? '',
          startDate: tournament.startDate ?? null,
          endDate: tournament.endDate ?? null,
          participantId: participant.participantId,
          participantName: participant.participantName ?? '',
          eventCount: countParticipantEvents(tournament, participant.participantId),
        });
      }
    }
    out.sort(byStartDateDesc);
    return { personId, participations: out };
  }

  /**
   * GET /auth/hiveid/me/claimable/:tournamentId — returns the Participants
   * in the given tournament whose canonical name overlaps the caller's
   * cached fields, MINUS anyone already linked to the caller's personId.
   * Defense-in-depth: the actual claim mutation re-verifies before
   * stamping (see `claimParticipant`).
   */
  async getClaimableForTournament(userId: string, tournamentId: string): Promise<{
    tournamentId: string;
    candidates: ClaimableCandidate[];
  }> {
    if (!userId) throw new UnauthorizedException();
    if (!tournamentId) throw new BadRequestException('tournamentId is required');

    const link = await this.userStorage.getPersonLink(userId);
    const personId = link?.personId ?? null;
    const cached = link?.cached;
    if (!cached?.standardGivenName || !cached?.standardFamilyName) {
      return { tournamentId, candidates: [] };
    }

    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) return { tournamentId, candidates: [] };

    const targetGiven = normalizeName(cached.standardGivenName);
    const targetFamily = normalizeName(cached.standardFamilyName);
    const participants: any[] = tournamentRecord.participants ?? [];
    const candidates: ClaimableCandidate[] = [];
    for (const p of participants) {
      if (!isIndividualParticipant(p)) continue;
      if (personId && participantMatchesPerson(p, personId)) continue;
      const personGiven = normalizeName(p?.person?.standardGivenName ?? p?.person?.givenName ?? '');
      const personFamily = normalizeName(p?.person?.standardFamilyName ?? p?.person?.familyName ?? '');
      const nameMatches =
        (personGiven && personGiven === targetGiven) ||
        (personFamily && personFamily === targetFamily);
      if (!nameMatches) continue;
      candidates.push({
        participantId: p.participantId,
        participantName: p.participantName ?? '',
        sex: p?.person?.sex ?? null,
        nationalityCode: p?.person?.nationalityCode ?? null,
        birthDate: p?.person?.birthDate ?? null,
        alreadyLinkedTo: extractCanonicalPersonId(p),
      });
    }
    return { tournamentId, candidates };
  }

  /**
   * POST /auth/hiveid/me/claim — stamp a `CANONICAL_PERSON`-keyed entry
   * onto the target Participant's `Person.personOtherIds[]` via the
   * `addPersonOtherId` factory mutation (PR-K). Defense-in-depth: the
   * server reloads the tournament and re-verifies the participant exists
   * and that the cached name overlaps before firing.
   */
  async claimParticipant(args: {
    userId: string;
    tournamentId: string;
    participantId: string;
    auditSource?: string;
  }): Promise<{ success: true; tournamentId: string; participantId: string; personId: string }> {
    const { userId, tournamentId, participantId } = args;
    if (!userId) throw new UnauthorizedException();
    if (!tournamentId || !participantId) {
      throw new BadRequestException('tournamentId and participantId are required');
    }

    const link = await this.userStorage.getPersonLink(userId);
    const personId = link?.personId;
    if (!personId) {
      throw new BadRequestException('Your HiveID does not yet have a canonical link.');
    }

    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) throw new BadRequestException('Tournament not found');
    const target = (tournamentRecord.participants ?? []).find((p: any) => p?.participantId === participantId);
    if (!target) throw new BadRequestException('Participant not found in tournament');
    if (!isIndividualParticipant(target)) {
      throw new BadRequestException('Only INDIVIDUAL participants can be claimed');
    }

    const cached = link.cached;
    const targetGiven = normalizeName(cached?.standardGivenName ?? '');
    const targetFamily = normalizeName(cached?.standardFamilyName ?? '');
    const personGiven = normalizeName(target?.person?.standardGivenName ?? target?.person?.givenName ?? '');
    const personFamily = normalizeName(target?.person?.standardFamilyName ?? target?.person?.familyName ?? '');
    const overlap =
      (targetGiven && targetGiven === personGiven) || (targetFamily && targetFamily === personFamily);
    if (!overlap) {
      throw new BadRequestException(
        'The target participant does not match your canonical name. If this is you, contact the tournament director.',
      );
    }

    const result = await runExecutionQueue(
      {
        tournamentIds: [tournamentId],
        methods: [
          {
            method: 'addPersonOtherId',
            params: {
              tournamentId,
              participantId,
              organisationId: CANONICAL_PERSON,
              personId,
            },
          },
        ],
        userId,
        userEmail: undefined,
        source: args.auditSource ?? 'hiveid-claim',
      },
      undefined,
      this.tournamentStorageService,
      this.auditService,
    );
    if (!result?.success) {
      const error = result?.error ?? 'addPersonOtherId mutation failed';
      throw new BadRequestException(typeof error === 'string' ? error : JSON.stringify(error));
    }
    return { success: true, tournamentId, participantId, personId };
  }
}
