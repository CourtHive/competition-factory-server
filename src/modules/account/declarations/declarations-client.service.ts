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

/** A pending/decided REGISTRATION declaration, as the declarations service returns it. */
export interface RegistrationSnapshot {
  declarationId: string;
  personId: string;
  providerId: string;
  tournamentId: string | null;
  status: string;
  payload: { eventIds?: string[]; partner?: any; notes?: string; answers?: Record<string, unknown> };
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
}
