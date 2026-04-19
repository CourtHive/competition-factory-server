import { Injectable, Logger } from '@nestjs/common';

export type InstanceRole = 'local' | 'cloud';

@Injectable()
export class RelayConfig {
  private readonly logger = new Logger(RelayConfig.name);

  get role(): InstanceRole {
    const raw = (process.env.INSTANCE_ROLE ?? 'local').toLowerCase();
    return raw === 'cloud' ? 'cloud' : 'local';
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
