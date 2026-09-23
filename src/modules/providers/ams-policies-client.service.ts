import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_AMS_BASE_URL = 'http://localhost:3130';

function amsDisabled(baseUrl: string): boolean {
  if (process.env.AMS_DISABLED === 'true') return true;
  return baseUrl.trim().toLowerCase() === 'disabled';
}

/** The subset of `RequestInit` this client uses. Declared locally because the DOM lib's global
 *  is not in the lint environment for this Node service. */
type FetchInit = { method?: string; body?: string; headers?: Record<string, string> };

export interface ArchivedPolicy {
  policyId: string;
  providerId: string | null;
  policyType: string;
  name: string;
  version: string;
  visibility: string;
  definition: any;
  metadata?: any;
  publishedAt: string;
  publishedBy?: string | null;
  deletedAt: string | null;
}

/**
 * The provider half of policy lifecycle, which lives in AMS (punch-list P31).
 *
 * Policy hosting moved to AMS on 2026-09-23, but provider archive/delete/revive remained CFS
 * events. `ams.policy.provider_id` is TEXT with no foreign key — providers are in THIS database, so
 * nothing cascades. Without these calls a deleted provider left its policy rows in AMS forever, and
 * an archived provider's policies were missing from the archive meant to make it revivable.
 *
 * Direction matches the existing channel: CFS calls AMS with `x-service-token`, exactly as
 * `SanctioningClient` does. AMS never calls CFS.
 *
 * **Every method degrades rather than throwing.** A provider decommission must not be blocked
 * because AMS is unreachable — the archive should record what it could reach and say what it could
 * not, which is why each returns a result carrying `ok`. Silent success would be the worse failure:
 * an archive that looks complete and is not.
 */
@Injectable()
export class AmsPoliciesClient {
  private readonly logger = new Logger(AmsPoliciesClient.name);
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor() {
    this.baseUrl = process.env.AMS_BASE_URL ?? DEFAULT_AMS_BASE_URL;
    this.serviceToken = process.env.AMS_SERVICE_TOKEN ?? '';
  }

  isDisabled(): boolean {
    return amsDisabled(this.baseUrl);
  }

  private async call(path: string, init?: FetchInit): Promise<{ ok: boolean; body?: any; reason?: string }> {
    if (this.isDisabled()) return { ok: false, reason: 'ams-disabled' };
    try {
      const res = await fetch(`${this.baseUrl}/policies/provider-lifecycle/${path}`, {
        ...init,
        headers: { 'x-service-token': this.serviceToken, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      return { ok: true, body: await res.json() };
    } catch (err: any) {
      this.logger.warn(`AMS policy lifecycle call failed (${path}): ${err?.message ?? err}`);
      return { ok: false, reason: err?.message ?? 'unreachable' };
    }
  }

  /** Everything AMS holds for the provider, soft-deleted rows included, for the archive. */
  async exportForProvider(
    providerId: string,
  ): Promise<{ ok: boolean; policies: ArchivedPolicy[]; archivedPolicyIds: string[]; reason?: string }> {
    const result = await this.call(`${encodeURIComponent(providerId)}/export`);
    if (!result.ok) return { ok: false, policies: [], archivedPolicyIds: [], reason: result.reason };
    return {
      ok: true,
      policies: result.body?.policies ?? [],
      archivedPolicyIds: result.body?.archivedPolicyIds ?? [],
    };
  }

  /** Counts, for a delete preview that has to state what will be destroyed. */
  async summarize(providerId: string): Promise<{ ok: boolean; active: number; deleted: number; reason?: string }> {
    const result = await this.call(`${encodeURIComponent(providerId)}/summary`);
    if (!result.ok) return { ok: false, active: 0, deleted: 0, reason: result.reason };
    return { ok: true, active: result.body?.active ?? 0, deleted: result.body?.deleted ?? 0 };
  }

  /** Soft-delete the provider's active policies; the returned ids are what a revive restores. */
  async archive(providerId: string): Promise<{ ok: boolean; archivedPolicyIds: string[]; reason?: string }> {
    const result = await this.call(`${encodeURIComponent(providerId)}/archive`, { method: 'POST' });
    if (!result.ok) return { ok: false, archivedPolicyIds: [], reason: result.reason };
    return { ok: true, archivedPolicyIds: result.body?.archivedPolicyIds ?? [] };
  }

  /** Restore exactly the ids the archive recorded — never "everything deleted for this provider". */
  async restore(policyIds: string[]): Promise<{ ok: boolean; restored: number; reason?: string }> {
    if (!policyIds?.length) return { ok: true, restored: 0 };
    const result = await this.call('restore', { method: 'POST', body: JSON.stringify({ policyIds }) });
    if (!result.ok) return { ok: false, restored: 0, reason: result.reason };
    return { ok: true, restored: result.body?.restored ?? 0 };
  }

  /** Irreversible; the provider-delete counterpart of the old ON DELETE CASCADE. */
  async purge(providerId: string): Promise<{ ok: boolean; purged: number; reason?: string }> {
    const result = await this.call(`${encodeURIComponent(providerId)}`, { method: 'DELETE' });
    if (!result.ok) return { ok: false, purged: 0, reason: result.reason };
    return { ok: true, purged: result.body?.purged ?? 0 };
  }
}
