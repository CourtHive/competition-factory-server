/**
 * SanctioningClient — CFS-side client for courthive-ams (the sanctioning service).
 * Mirrors DeclarationsClient/PersonsClient: Node native fetch, base URL + disable
 * switch from env, no new npm deps.
 *
 * CFS reads the FULL sanctioning record (service token) to activate a tournament from it: by the
 * tournamentId assigned at open-registration, on the first accepted registration; or by the record's own id, when
 * the provider administrator activates from the AMS console. Having stored the tournament, it tells AMS the record is
 * ACTIVE. Only CFS stores tournaments, so AMS never activates on its own.
 */
import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_AMS_BASE_URL = 'http://localhost:3130';

/** The full sanctioning record as AMS returns it (proposal + governance + policy). */
export interface SanctioningRecordSnapshot {
  sanctioningId: string;
  status: string;
  governingBodyId?: string;
  governingBody?: { organisationId?: string } & Record<string, unknown>;
  /**
   * The tier the tournament was sanctioned at. A `TierClassification` — the same shape a
   * tournament's `tournamentTier` uses — since the factory unified `sanctioningLevel` and
   * `sanctioningTier` onto one type; AMS stores and returns both halves.
   *
   * CFS does not read this itself: the whole snapshot is handed to the factory's
   * `activateFromSanctioning`, which copies the tier onto the activated tournament. It is declared
   * so the snapshot type stays an accurate description of what AMS actually sends.
   */
  sanctioningTier?: { system: string; value: string };
  policySnapshot?: unknown;
  /**
   * Policies resolved by AMS when the record was APPROVED: the provider's (or governing body's)
   * policies that DIFFER from factory defaults. `rankingPoints` is never among them — those drive
   * back-end ranking pipelines and are read per-provider by TMX instead.
   *
   * Definitions travel, not references, so activation needs no second call to AMS.
   * `undefined` means the record was never approved; `[]` means resolved and nothing differed.
   */
  attachedPolicies?: Array<{
    policyType: string;
    name: string;
    version: string;
    definition: Record<string, unknown>;
    sourceProviderId?: string;
    sourceRole?: string;
  }>;
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
    const res = await fetch(`${this.baseUrl}/sanctioning/record-by-tournament/${encodeURIComponent(tournamentId)}`, {
      headers: { 'x-service-token': this.serviceToken },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`sanctioning getRecordByTournamentId failed: HTTP ${res.status}`);
    }
    return (await res.json()) as SanctioningRecordSnapshot | null;
  }

  /** The full sanctioning record by its own id. Returns null when disabled or absent (404). */
  async getRecordById(sanctioningId: string): Promise<SanctioningRecordSnapshot | null> {
    if (!sanctioningId) return null;
    if (this.isDisabled()) {
      this.logger.log('sanctioning client disabled — skipping record fetch');
      return null;
    }
    const res = await fetch(`${this.baseUrl}/sanctioning/record-by-id/${encodeURIComponent(sanctioningId)}`, {
      headers: { 'x-service-token': this.serviceToken },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sanctioning getRecordById failed: HTTP ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as SanctioningRecordSnapshot | null) : null;
  }

  /**
   * Tell AMS the tournament for an APPROVED record now exists, so the record becomes ACTIVE under its id. AMS answers
   * success again for a record already ACTIVE under the same tournament, so a retry is safe.
   */
  async markActivated(sanctioningId: string, tournamentId: string): Promise<void> {
    if (this.isDisabled()) return;
    const res = await fetch(`${this.baseUrl}/sanctioning/records/${encodeURIComponent(sanctioningId)}/activated`, {
      method: 'POST',
      headers: { 'x-service-token': this.serviceToken, 'content-type': 'application/json' },
      body: JSON.stringify({ tournamentId }),
    });
    if (!res.ok) throw new Error(`sanctioning markActivated failed: HTTP ${res.status} ${await res.text()}`);
  }
}
