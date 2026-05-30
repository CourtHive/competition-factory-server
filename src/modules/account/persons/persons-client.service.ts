// PersonsClient — CFS-side client for courthive-persons.
//
// Two responsibilities:
//   1. Thin HTTP wrapper for /persons/resolve and /persons/:id used by
//      the /auth/hiveid signup flow (PR-G).
//   2. SSE consumer subscribed to /persons/events. On every
//      personMerged event, look up local users.person_id = deprecatedId
//      and rewrite to survivorId + refreshed cached fields, so the
//      denormalized cache in the users table stays in sync with the
//      canonical Person registry.
//
// No new npm deps — Node 22 native fetch + a tiny SSE parser
// (./sse-parser.ts). Reconnection: 5s backoff on stream error, resume
// with ?since=<last_seen_occurredAt> so we don't replay history.
//
// Lifecycle: starts on OnApplicationBootstrap, aborts on
// OnApplicationShutdown. Survives transient courthive-persons restarts.

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { CachedPersonFields, IUserStorage, USER_STORAGE } from '../../../storage/interfaces/user-storage.interface';
import { consumeSseStream } from './sse-parser';

const DEFAULT_PERSONS_BASE_URL = 'http://localhost:3100';
const RECONNECT_DELAY_MS = 5000;

export interface PersonOtherId {
  provider: string;
  externalId: string;
}

export interface PersonFragmentInput {
  standardFamilyName?: string;
  standardGivenName?: string;
  birthDate?: string;
  sex?: string;
  nationalityCode?: string;
  tennisId?: string;
  personOtherIds?: PersonOtherId[];
  source?: string;
}

export interface ResolveResult {
  status: 'resolved' | 'minted' | 'candidate' | 'incomplete';
  personId?: string;
  personRevision?: number;
  candidates?: { personId: string; confidence: number }[];
  missingFields?: string[];
}

export interface PersonRow {
  personId: string;
  standardFamilyName: string | null;
  standardGivenName: string | null;
  birthDate: string | null;
  sex: string | null;
  nationalityCode: string | null;
  tennisId: string | null;
  mergedInto: string | null;
  personRevision: number;
}

export interface PersonWithAliases {
  person: PersonRow;
  aliases: { provider: string; externalId: string }[];
}

export interface PersonsClientStatus {
  baseUrl: string;
  connected: boolean;
  lastEventAt: string | null;
  consecutiveErrors: number;
}

@Injectable()
export class PersonsClient implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PersonsClient.name);
  private readonly baseUrl: string;
  private readonly controller = new AbortController();
  private lastEventAt: string | null = null;
  private connected = false;
  private consecutiveErrors = 0;
  private streamLoop: Promise<void> | null = null;

  constructor(@Inject(USER_STORAGE) private readonly userStorage: IUserStorage) {
    this.baseUrl = process.env.PERSONS_BASE_URL ?? DEFAULT_PERSONS_BASE_URL;
  }

  onApplicationBootstrap(): void {
    this.streamLoop = this.runStreamLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.controller.abort();
    if (this.streamLoop) {
      try {
        await this.streamLoop;
      } catch {
        // Aborts are expected during shutdown.
      }
    }
  }

  async resolve(fragment: PersonFragmentInput): Promise<ResolveResult> {
    const res = await fetch(`${this.baseUrl}/persons/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fragment),
    });
    if (!res.ok) {
      throw new Error(`persons resolve failed: HTTP ${res.status}`);
    }
    return (await res.json()) as ResolveResult;
  }

  async getById(personId: string): Promise<PersonWithAliases | null> {
    const res = await fetch(`${this.baseUrl}/persons/${encodeURIComponent(personId)}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`persons getById failed: HTTP ${res.status}`);
    }
    return (await res.json()) as PersonWithAliases;
  }

  getStatus(): PersonsClientStatus {
    return {
      baseUrl: this.baseUrl,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  /** Exposed for tests. The bootstrap call wraps this in a never-ending loop. */
  async runStreamLoop(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        await this.openStream();
        this.consecutiveErrors = 0;
      } catch (err) {
        this.connected = false;
        this.consecutiveErrors++;
        if (this.controller.signal.aborted) return;
        this.logger.warn(`SSE stream error (${this.consecutiveErrors}x): ${(err as Error).message}`);
      }
      if (this.controller.signal.aborted) return;
      await this.sleep(RECONNECT_DELAY_MS);
    }
  }

  private async openStream(): Promise<void> {
    const url = new URL(`${this.baseUrl}/persons/events`);
    if (this.lastEventAt) url.searchParams.set('since', this.lastEventAt);
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: this.controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} opening SSE`);
    }
    this.connected = true;
    this.logger.log(`SSE connected to ${url.href}`);
    await consumeSseStream(res, (event) => this.dispatchEvent(event), this.controller.signal);
  }

  private async dispatchEvent(event: { event: string; data: any }): Promise<void> {
    if (event.event !== 'personMerged') return;
    const { eventId, survivorId, deprecatedId, occurredAt } = event.data ?? {};
    if (!survivorId || !deprecatedId) {
      this.logger.warn(`malformed personMerged event ${eventId}: missing ids`);
      return;
    }
    try {
      await this.handleMerge({ survivorId, deprecatedId });
      this.lastEventAt = occurredAt ?? this.lastEventAt;
    } catch (err) {
      this.logger.error(`handleMerge failed for ${eventId}: ${(err as Error).message}`);
    }
  }

  /** Exposed for tests. Fetches survivor canonical fields then rewrites
   *  any local users rows that referenced the deprecated personId. */
  async handleMerge(args: { survivorId: string; deprecatedId: string }): Promise<void> {
    const survivor = await this.getById(args.survivorId);
    if (!survivor) {
      this.logger.warn(`merge survivor ${args.survivorId} not found — skipping rewrite`);
      return;
    }
    const cached: CachedPersonFields = {
      standardFamilyName: survivor.person.standardFamilyName,
      standardGivenName: survivor.person.standardGivenName,
      birthDate: survivor.person.birthDate,
      sex: survivor.person.sex,
      nationalityCode: survivor.person.nationalityCode,
    };
    const result = await this.userStorage.rewritePersonId({
      fromPersonId: args.deprecatedId,
      toPersonId: args.survivorId,
      personRevision: survivor.person.personRevision,
      cached,
    });
    if (result.rewrittenCount > 0) {
      this.logger.log(`rewrote ${result.rewrittenCount} users row(s): ${args.deprecatedId} -> ${args.survivorId}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (this.controller.signal.aborted) {
        clearTimeout(timer);
        resolve();
      } else {
        this.controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      }
    });
  }
}
