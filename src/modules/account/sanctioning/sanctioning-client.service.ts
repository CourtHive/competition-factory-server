/**
 * SanctioningClient — CFS-side client for courthive-ams (the sanctioning service).
 * Mirrors DeclarationsClient/PersonsClient: Node native fetch, base URL + disable
 * switch from env, no new npm deps.
 *
 * The only call CFS makes is the service-token-guarded FULL sanctioning record by
 * tournamentId, used to lazy-activate a tournamentRecord on the first accept for a
 * sanctioning-originated tournament (runs the factory `activateFromSanctioning`).
 */
import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_AMS_BASE_URL = 'http://localhost:3130';

/** The full sanctioning record as AMS returns it (proposal + governance + policy). */
export interface SanctioningRecordSnapshot {
  sanctioningId: string;
  status: string;
  governingBodyId?: string;
  governingBody?: { organisationId?: string } & Record<string, unknown>;
  sanctioningLevel?: string;
  policySnapshot?: unknown;
  proposal: {
    tournamentId?: string;
    events?: Array<{ eventId?: string; eventName?: string }>;
    [key: string]: unknown;
  };
}

/**
 * Disable the client (deployments without AMS reachable). Mirrors the sibling
 * clients: explicit flag, or the convenience `=disabled` URL. Disabled → the
 * lazy-activation lookup returns null (accept then 404s if no record exists).
 */
function amsDisabled(baseUrl: string): boolean {
  if (process.env.AMS_DISABLED === 'true') return true;
  return baseUrl.trim().toLowerCase() === 'disabled';
}

@Injectable()
export class SanctioningClient {
  private readonly logger = new Logger(SanctioningClient.name);
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor() {
    this.baseUrl = process.env.AMS_BASE_URL ?? DEFAULT_AMS_BASE_URL;
    this.serviceToken = process.env.AMS_SERVICE_TOKEN ?? '';
  }

  isDisabled(): boolean {
    return amsDisabled(this.baseUrl);
  }

  /**
   * The full sanctioning record by the tournamentId assigned at open-registration.
   * Returns null when disabled or absent (404).
   */
  async getRecordByTournamentId(tournamentId: string): Promise<SanctioningRecordSnapshot | null> {
    if (!tournamentId) return null;
    if (this.isDisabled()) {
      this.logger.log('sanctioning client disabled — skipping record fetch');
      return null;
    }
    const res = await fetch(
      `${this.baseUrl}/sanctioning/record-by-tournament/${encodeURIComponent(tournamentId)}`,
      { headers: { 'x-service-token': this.serviceToken } },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`sanctioning getRecordByTournamentId failed: HTTP ${res.status}`);
    }
    return (await res.json()) as SanctioningRecordSnapshot | null;
  }
}
