import { Injectable, Logger } from '@nestjs/common';

export type InstanceRole = 'local' | 'cloud';

/**
 * Resolve the instance role from the environment.
 *
 * DEFAULTS TO `cloud`, and anything unrecognised also resolves to `cloud`.
 * `local` must be opted into explicitly.
 *
 * This inverted on 2026-08-15. The previous default was `local`, which meant the
 * PRODUCTION cloud server ran the local-side services — the mutation mirror and
 * the `/factory/sync/*` routes — purely because nothing set the variable. It was
 * inert only by accident (`UPSTREAM_SERVER_URL` happened to be unset), which is
 * the definition of a fail-open default under
 * `Mentat/standards/architectural-standards.md` A3: the misconfiguration an
 * operator is most likely to make must not be the dangerous one.
 *
 * `local` is the rarer, more privileged deployment — a venue appliance that
 * mirrors mutations to an upstream server. Requiring it to be declared means an
 * instance can only take on that behaviour deliberately.
 *
 * Exported as a free function (not just a getter) because `RelayModule.forRoot()`
 * and `TournamentSyncModule.forRoot()` both need the role at MODULE-CONSTRUCTION
 * time, before DI can hand them a `RelayConfig`. They previously each inlined
 * their own copy of the parse, so a change here silently applied to one and not
 * the others.
 */
export function resolveInstanceRole(): InstanceRole {
  const raw = (process.env.INSTANCE_ROLE ?? 'cloud').trim().toLowerCase();
  return raw === 'local' ? 'local' : 'cloud';
}

/**
 * Whether site-server federation is configured on this instance.
 *
 * Gates the cloud-side export controller. Without this, flipping the default to
 * `cloud` would have ADDED `GET /factory/tournaments` (an unbounded
 * `listTournamentIds()` behind a shared static bearer, already on the design-flaw
 * punch list as an A7 offender) to every instance that had simply never set
 * `INSTANCE_ROLE` — trading one fail-open for another.
 *
 * With the gate, an instance that has not configured federation contributes
 * nothing from this module in either role.
 */
export function isFederationConfigured(): boolean {
  return Boolean(process.env.UPSTREAM_API_KEY?.trim());
}

@Injectable()
export class RelayConfig {
  private readonly logger = new Logger(RelayConfig.name);

  get role(): InstanceRole {
    return resolveInstanceRole();
  }

  get venueId(): string {
    return process.env.LOCAL_VENUE_ID ?? 'arena-dev-00';
  }

  get cloudRelayUrl(): string | undefined {
    return process.env.CLOUD_RELAY_URL?.trim() || undefined;
  }

  get cloudRelayApiKey(): string | undefined {
    return process.env.CLOUD_RELAY_API_KEY?.trim() || undefined;
  }

  get cloudRelayQueuePath(): string {
    return process.env.CLOUD_RELAY_QUEUE_PATH ?? './.data/cloud-queue';
  }

  get maxBatchSize(): number {
    const raw = Number(process.env.CLOUD_RELAY_MAX_BATCH);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
  }

  get drainIntervalMs(): number {
    const raw = Number(process.env.CLOUD_RELAY_DRAIN_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5000;
  }

  // Local-only: upstream factory-server URL for tournament import + mutation mirror
  get upstreamServerUrl(): string | undefined {
    return process.env.UPSTREAM_SERVER_URL?.trim() || undefined;
  }

  get upstreamApiKey(): string | undefined {
    return process.env.UPSTREAM_API_KEY?.trim() || undefined;
  }

  // Cloud-only: parses VENUE_API_KEYS env var into a map of venueId -> apiKey.
  // Format: "venue-1:abc123,venue-2:def456"
  get venueApiKeys(): Map<string, string> {
    const raw = process.env.VENUE_API_KEYS ?? '';
    const map = new Map<string, string>();
    for (const pair of raw.split(',')) {
      const [venueId, apiKey] = pair.split(':');
      if (venueId?.trim() && apiKey?.trim()) {
        map.set(venueId.trim(), apiKey.trim());
      }
    }
    return map;
  }

  validate(): void {
    if (this.role === 'local' && !this.cloudRelayUrl) {
      this.logger.warn(
        'INSTANCE_ROLE=local but CLOUD_RELAY_URL is unset — outbound relay will queue indefinitely',
      );
    }
    if (this.role === 'cloud' && this.venueApiKeys.size === 0) {
      this.logger.warn('INSTANCE_ROLE=cloud but VENUE_API_KEYS is empty — no venues will be authorized');
    }
  }
}
