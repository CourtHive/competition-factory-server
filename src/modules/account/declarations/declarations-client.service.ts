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

const DEFAULT_DECLARATIONS_BASE_URL = 'http://localhost:3110';

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
}
