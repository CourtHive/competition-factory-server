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

/**
 * Initial reconnect delay after a transient SSE failure. Doubles on each
 * subsequent failure up to RECONNECT_MAX_DELAY_MS. Restores to the
 * initial value on a successful (re-)connection.
 */
const RECONNECT_INITIAL_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60_000;

/**
 * Disable the SSE consumer entirely. Two ways to opt out:
 *   PERSONS_DISABLED=true               — explicit flag, recommended
 *   PERSONS_BASE_URL=disabled           — convenience: many envs lazily
 *                                          set an empty URL when persons
 *                                          isn't deployed there yet
 * Both leave the HTTP `resolve` + `getById` methods callable but skip
 * the always-on reconnect loop, so deployments without persons stop
 * hammering the network and the logs.
 */
function personsDisabled(baseUrl: string): boolean {
  if (process.env.PERSONS_DISABLED === 'true') return true;
  return baseUrl.trim().toLowerCase() === 'disabled';
}

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
    if (personsDisabled(this.baseUrl)) {
      this.logger.log('persons SSE consumer disabled via PERSONS_DISABLED / PERSONS_BASE_URL=disabled');
      return;
    }
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
        if (this.consecutiveErrors > 0) {
          // Promoted to WARN so it mirrors the failure WARN: main.ts's
          // logger config strips 'log' (see ['fatal','verbose','debug',
          // 'error','warn']), so without this an outage emits visible
          // WARNs forever and recovery is silent.
          this.logger.warn(`persons SSE recovered after ${this.consecutiveErrors} failure(s)`);
        }
        this.consecutiveErrors = 0;
      } catch (err) {
        this.connected = false;
        this.consecutiveErrors++;
        if (this.controller.signal.aborted) return;
        this.logFailure(err as Error);
      }
      if (this.controller.signal.aborted) return;
      await this.sleep(this.computeBackoffMs());
    }
  }

  /**
   * Exponential backoff with a 60s cap: 5s, 10s, 20s, 40s, then 60s
   * forever. Quiet enough that an unreachable persons service stops
   * hammering local DNS / TCP and stops drowning the logs, but still
   * snappy enough to reconnect within a minute once persons is back.
   */
  private computeBackoffMs(): number {
    if (this.consecutiveErrors <= 0) return RECONNECT_INITIAL_DELAY_MS;
    const exp = Math.min(this.consecutiveErrors - 1, 10); // cap shift before Math.pow
    const delay = RECONNECT_INITIAL_DELAY_MS * 2 ** exp;
    return Math.min(delay, RECONNECT_MAX_DELAY_MS);
  }

  /**
   * Log throttling — every error otherwise produces a WARN line, so a
   * persons outage of a few hours generates thousands of identical
   * log lines. Emit the first failure loudly so the operator notices,
   * then suppress until a milestone (10, 100, 1000, …) or every 50th
   * failure once we're past the early stages.
   */
  private logFailure(err: Error): void {
    const n = this.consecutiveErrors;
    const isMilestone = n === 1 || n === 10 || n === 100 || n === 1000 || n % 50 === 0;
    const message = `SSE stream error (${n}x): ${err.message}`;
    if (isMilestone) {
      this.logger.warn(message);
    } else {
      this.logger.debug(message);
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
    // WARN — matches the failure WARN level so the connect confirmation
    // is visible under main.ts's logger filter (no 'log' level).
    this.logger.warn(`SSE connected to ${url.href}`);
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
