/**
 * RegistrationsService — applicant-side surface for HiveID Phase 2-A.
 *
 * Director-side acceptance (Phase 2-B — accept / waitlist / reject and
 * fire `addParticipants` into the factory) lives in a TMX-side
 * controller landing in a follow-on. This service owns ONLY the
 * applicant flows that the public app needs today:
 *
 *   - submit a registration (creates an `applied` entry, or re-applies
 *     a previously withdrawn one)
 *   - list my own registrations across every tournament
 *   - withdraw a registration I own (terminal applicant state)
 *
 * Every method is gated on the caller's HiveID `userId` matching the
 * row's `user_id` — the controller resolves the userId from the
 * audience-aware AuthGuard payload.
 */
import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import {
  REGISTRATION_ENTRY_STORAGE,
  type IRegistrationEntryStorage,
  type RegistrationEntry,
  USER_STORAGE,
  type IUserStorage,
} from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';

export interface ApplyForTournamentInput {
  userId: string;
  tournamentId: string;
  eventIds?: string[];
  partnerUserId?: string | null;
  answers?: Record<string, unknown>;
}

@Injectable()
export class RegistrationsService {
  constructor(
    @Inject(REGISTRATION_ENTRY_STORAGE)
    private readonly storage: IRegistrationEntryStorage,
    @Inject(USER_STORAGE)
    private readonly userStorage: IUserStorage,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  async apply(input: ApplyForTournamentInput): Promise<RegistrationEntry> {
    if (!input.userId) throw new UnauthorizedException();
    if (!input.tournamentId) throw new BadRequestException('tournamentId is required');

    // Verify the tournament exists + entries are open. The tournament
    // record's `registrationProfile.entriesClose` (when set) gates
    // applicant-side submits; absence means the director hasn't
    // published a window and the form is closed.
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

    // Cross-check the user's HiveID person link so the entry can be
    // matched against canonical Person records in the director view.
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
}

function filterValidEventIds(tournamentRecord: any, requested?: string[]): string[] {
  if (!requested?.length) return [];
  const validIds = new Set<string>();
  for (const event of tournamentRecord?.events ?? []) {
    if (event?.eventId) validIds.add(event.eventId);
  }
  return requested.filter((id) => typeof id === 'string' && validIds.has(id));
}
