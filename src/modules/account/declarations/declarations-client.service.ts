/**
 * DeclarationsClient — CFS-side client for courthive-declarations (the persons-
 * tier declarations service). Mirrors PersonsClient's shape: Node native fetch,
 * base URL + disable switch from env, no new npm deps.
 *
 * The only call CFS makes is the service-token-guarded availability snapshot for
 * the TD pull. All player-facing writes terminate at the declarations service —
 * CFS never touches them.
 */
import { Injectable, Logger } from '@nestjs/common';

import { AvailabilitySnapshot } from './availability-pull.helpers';

const DEFAULT_DECLARATIONS_BASE_URL = 'http://localhost:3120';

/** Pair-status for a PARTNER_INVITE (the accept-PAIR read). */
export interface PairStatus {
  complete: boolean;
  tournamentId: string | null;
  event: string | null;
  eventId: string | null;
  nominatorPersonId: string | null;
  inviteePersonId: string | null;
}

/** A pending/decided REGISTRATION declaration, as the declarations service returns it. */
/**
 * A participant's identity in ANOTHER organisation's system, as it arrives on a
 * registration. Structurally mirrors the factory's `UnifiedParticipantID`.
 *
 * Declared here rather than imported from `tods-competition-factory` ON PURPOSE: the type
 * ships with factory #4620, which is merged but not yet released, and CI installs the
 * PUBLISHED package. Importing it now would build locally through the `link:` override and
 * fail on CI. Swap this for the factory import once the pin reaches the release carrying
 * it — the shape is identical, so that change is a one-liner with no behavioural effect.
 *
 * The runtime does NOT need the new factory: `addParticipant` commits with
 * `tournamentRecord.participants?.push(participant)`, storing the object wholesale and
 * unfiltered, so the stamped field survives on any factory version.
 */
export interface RegistrationParticipantOtherId {
  organisationId: string;
  participantId: string;
  uniqueOrganisationName?: string;
}

export interface RegistrationSnapshot {
  declarationId: string;
  personId: string;
  providerId: string;
  tournamentId: string | null;
  status: string;
  payload: {
    eventIds?: string[];
    partner?: any;
    partnerInviteId?: string;
    notes?: string;
    answers?: Record<string, unknown>;
    /** The CFS-attested applicant name, denormalized onto the payload by declarations
     *  `apply()` so the off-CFS pending list is showable without a persons lookup. Was
     *  always written and always read (through an `as any` cast) but never declared. */
    applicant?: { givenName?: string; familyName?: string };
    /** Set when the registration originated with an OUTSIDE sanctioning body: that body's
     *  own id(s) for this competitor. Stamped onto the participant at accept so results
     *  can be addressed back to the system that registered them. Absent for an ordinary
     *  self-registration. */
    participantOtherIds?: RegistrationParticipantOtherId[];
  };
  /** The participantId reserved by courthive-declarations when the person registered.
   *  Carried into the tournamentRecord at accept instead of minting a fresh one, so the
   *  identity predates every record and is the same value in each record that ends up
   *  holding this participation. Null for registrations predating declarations migration
   *  0004 — accept still mints for those. */
  participantId?: string | null;
  updatedAt: string;
}

/**
 * Disable the client (deployments without the declarations service). Mirrors
 * PersonsClient: explicit flag, or the convenience `=disabled` URL. Disabled →
 * the pull returns an empty snapshot rather than erroring.
 */
function declarationsDisabled(baseUrl: string): boolean {
  if (process.env.DECLARATIONS_DISABLED === 'true') return true;
  return baseUrl.trim().toLowerCase() === 'disabled';
}

@Injectable()
export class DeclarationsClient {
  private readonly logger = new Logger(DeclarationsClient.name);
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor() {
    this.baseUrl = process.env.DECLARATIONS_BASE_URL ?? DEFAULT_DECLARATIONS_BASE_URL;
    this.serviceToken = process.env.DECLARATIONS_SERVICE_TOKEN ?? '';
  }

  isDisabled(): boolean {
    return declarationsDisabled(this.baseUrl);
  }

  async getAvailability(personIds: string[], provider: string): Promise<AvailabilitySnapshot[]> {
    if (!personIds.length) return [];
    if (this.isDisabled()) {
      this.logger.log('declarations client disabled — skipping availability fetch');
      return [];
    }

    const query = `provider=${encodeURIComponent(provider)}&personIds=${encodeURIComponent(personIds.join(','))}`;
    const res = await fetch(`${this.baseUrl}/availability?${query}`, {
      headers: { 'x-service-token': this.serviceToken },
    });
    if (!res.ok) {
      throw new Error(`declarations getAvailability failed: HTTP ${res.status}`);
    }
    return (await res.json()) as AvailabilitySnapshot[];
  }

  /**
   * Pending/decided registrations for a tournament (scoped to its provider) — the
   * source for the TD acceptance list, now that pending registrations live off CFS.
   * Disabled → empty list.
   */
  async listRegistrations(tournamentId: string, provider: string): Promise<RegistrationSnapshot[]> {
    if (this.isDisabled()) {
      this.logger.log('declarations client disabled — skipping registrations fetch');
      return [];
    }
    const query = `provider=${encodeURIComponent(provider)}&tournamentId=${encodeURIComponent(tournamentId)}`;
    const res = await fetch(`${this.baseUrl}/registrations?${query}`, {
      headers: { 'x-service-token': this.serviceToken },
    });
    if (!res.ok) {
      throw new Error(`declarations listRegistrations failed: HTTP ${res.status}`);
    }
    return (await res.json()) as RegistrationSnapshot[];
  }

  /**
   * A single registration by its declaration id — CFS reads this authoritatively to
   * drive the accept (personId + eventIds + applicant name). Null when disabled/absent.
   */
  async getRegistration(declarationId: string): Promise<RegistrationSnapshot | null> {
    if (this.isDisabled()) return null;
    const res = await fetch(`${this.baseUrl}/registrations/${encodeURIComponent(declarationId)}`, {
      headers: { 'x-service-token': this.serviceToken },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`declarations getRegistration failed: HTTP ${res.status}`);
    }
    return (await res.json()) as RegistrationSnapshot | null;
  }

  /**
   * Stamp the TD decision (ACCEPTED / WAITLISTED / REJECTED) on a registration by
   * its declaration id. `transitionedBy` is the acting director. Returns null when
   * disabled or the registration is absent.
   */
  async transitionRegistration(args: {
    declarationId: string;
    toStatus: string;
    transitionedBy: string;
    reason?: string;
  }): Promise<RegistrationSnapshot | null> {
    if (this.isDisabled()) {
      this.logger.log('declarations client disabled — skipping registration transition');
      return null;
    }
    const res = await fetch(`${this.baseUrl}/registrations/${encodeURIComponent(args.declarationId)}/transition`, {
      method: 'POST',
      headers: { 'x-service-token': this.serviceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus: args.toStatus, transitionedBy: args.transitionedBy, reason: args.reason }),
    });
    if (!res.ok) {
      throw new Error(`declarations transitionRegistration failed: HTTP ${res.status}`);
    }
    return (await res.json()) as RegistrationSnapshot | null;
  }

  /**
   * Pair-status for a PARTNER_INVITE — the accept-PAIR read: whether the pair is
   * acceptable + the event and both personIds needed to build the PAIR participant.
   * Null when disabled or the invite is absent.
   */
  async getPairStatus(inviteDeclarationId: string): Promise<PairStatus | null> {
    if (this.isDisabled()) return null;
    const res = await fetch(
      `${this.baseUrl}/partner-invites/${encodeURIComponent(inviteDeclarationId)}/pair-status`,
      { headers: { 'x-service-token': this.serviceToken } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`declarations getPairStatus failed: HTTP ${res.status}`);
    return (await res.json()) as PairStatus | null;
  }
}
