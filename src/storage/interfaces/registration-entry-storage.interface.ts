export const REGISTRATION_ENTRY_STORAGE = Symbol('REGISTRATION_ENTRY_STORAGE');

/**
 * Lifecycle of a HiveID registration entry. Applicant-initiated states
 * (`applied`, `withdrawn`) are the only ones writable from
 * `/me/registrations`; director-initiated states (`accepted`, `seeded`,
 * `waitlisted`, `rejected`) flow through the TMX-side acceptance flow
 * (Phase 2-B). See migration 034 for the CHECK constraint that mirrors
 * this list.
 */
export type RegistrationStatus =
  | 'applied'
  | 'accepted'
  | 'seeded'
  | 'withdrawn'
  | 'waitlisted'
  | 'rejected';

export interface RegistrationEntry {
  registrationId: string;
  tournamentId: string;
  userId: string;
  personId: string | null;
  eventIds: string[];
  partnerUserId: string | null;
  answers: Record<string, unknown>;
  status: RegistrationStatus;
  statusReason: string | null;
  appliedAt: string;
  statusAt: string;
  decidedByUserId: string | null;
  /**
   * Populated by the Phase 2-B accept orchestrator at the same moment
   * the row's status flips to `accepted`. Logical FK to a TODS
   * Participant inside `tournament_id`'s tournamentRecord.
   */
  participantId: string | null;
  /**
   * Per-event entry snapshots taken at acceptance time —
   * `[{ eventId, entryStatus, entryStage }, ...]`. Lets the director
   * see what events an applicant was actually graduated into without
   * scanning the tournament record.
   */
  eventEntries: Array<{ eventId: string; entryStatus?: string; entryStage?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface RegistrationEntryUpsert {
  tournamentId: string;
  userId: string;
  personId?: string | null;
  eventIds?: string[];
  partnerUserId?: string | null;
  answers?: Record<string, unknown>;
}

export interface RegistrationStatusUpdate {
  registrationId: string;
  status: RegistrationStatus;
  statusReason?: string | null;
  decidedByUserId?: string | null;
}

export interface RegistrationParticipantLink {
  registrationId: string;
  participantId: string;
  eventEntries: Array<{ eventId: string; entryStatus?: string; entryStage?: string }>;
  decidedByUserId?: string | null;
  statusReason?: string | null;
}

export interface IRegistrationEntryStorage {
  /**
   * Create a fresh `applied` entry, OR if one already exists for
   * (tournamentId, userId), rewrite event_ids / partner / answers and
   * move it back to `applied` (re-applying after a withdrawal). Returns
   * the post-write row.
   */
  applyForTournament(args: RegistrationEntryUpsert): Promise<RegistrationEntry>;

  /** Look up by primary key. Returns `null` when no row exists. */
  findById(registrationId: string): Promise<RegistrationEntry | null>;

  /** All entries the given user has across every tournament, newest first. */
  listByUser(userId: string): Promise<RegistrationEntry[]>;

  /** All entries for one tournament — used by the director acceptance view. */
  listByTournament(tournamentId: string): Promise<RegistrationEntry[]>;

  /**
   * Status update — typically director-initiated (accepted / waitlisted /
   * rejected) or applicant-initiated (withdrawn). Stamps `status_at` +
   * `decided_by_user_id`.
   */
  updateStatus(args: RegistrationStatusUpdate): Promise<RegistrationEntry | null>;

  /**
   * Phase 2-B graduation — flips status to `accepted`, links the new
   * Participant id, and records which events were entered. Single
   * UPDATE so the row is never partially-written. Director acceptance
   * runs this AFTER `addParticipants` has succeeded in the factory.
   */
  linkParticipant(args: RegistrationParticipantLink): Promise<RegistrationEntry | null>;
}
