// RankingsWebhookService — outbound HTTP to courthive-rankings.
//
// On a tournament transition to COMPLETED/PUBLISHED (or any other
// trigger the operator wires up), call this service with the
// TODS tournament record. It POSTs to <RANKINGS_PIPELINE_URL>/tournaments/ingest
// with exponential-backoff retry and structured logging.
//
// Disabled when RANKINGS_PIPELINE_URL is unset — `publish()` becomes
// a no-op that returns { skipped: true }. This keeps the dependency
// optional: CFS runs fine without the rankings service deployed.
//
// Auto-trigger after tournament save is intentionally NOT wired in
// this PR — the only caller today is the admin republish endpoint,
// which lets an operator manually push a known tournament to the
// rankings pipeline. The auto-trigger needs deeper integration into
// the save path (factory/messaging modules) and is a follow-up.

import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

export interface WebhookResult {
  skipped?: boolean;
  ok?: boolean;
  status?: number;
  responseBody?: unknown;
  attempts?: number;
  error?: string;
}

@Injectable()
export class RankingsWebhookService {
  private readonly logger = new Logger(RankingsWebhookService.name);

  private readonly rankingsUrl = process.env.RANKINGS_PIPELINE_URL?.replace(/\/$/, '') ?? '';
  private readonly timeoutMs = Number(process.env.RANKINGS_PIPELINE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  private readonly maxRetries = Number(process.env.RANKINGS_PIPELINE_RETRIES ?? DEFAULT_RETRIES);

  isEnabled(): boolean {
    return Boolean(this.rankingsUrl);
  }

  async publish(tournamentRecord: any, opts: { source?: string; sourceRef?: string } = {}): Promise<WebhookResult> {
    if (!this.isEnabled()) {
      this.logger.debug('RANKINGS_PIPELINE_URL not set; webhook disabled');
      return { skipped: true };
    }

    const tournamentId = tournamentRecord?.tournamentId;
    if (!tournamentId) {
      return { ok: false, error: 'missing tournamentId in record' };
    }

    const body = JSON.stringify({
      tournamentRecord,
      source: opts.source ?? 'cfs-event',
      sourceRef: opts.sourceRef ?? `cfs:${tournamentId}`,
    });

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.attemptPost(body);
        if (result.ok) {
          this.logger.log(`rankings-webhook ok tournament=${tournamentId} attempt=${attempt} status=${result.status}`);
          return { ok: true, status: result.status, responseBody: result.responseBody, attempts: attempt };
        }
        lastError = `HTTP ${result.status}`;
        // Don't retry on 4xx — caller bug, retry won't help.
        if (result.status && result.status >= 400 && result.status < 500) {
          this.logger.warn(`rankings-webhook 4xx tournament=${tournamentId} status=${result.status}; not retrying`);
          return { ok: false, status: result.status, responseBody: result.responseBody, attempts: attempt };
        }
      } catch (err: any) {
        lastError = err?.message ?? String(err);
        this.logger.warn(`rankings-webhook attempt=${attempt} tournament=${tournamentId} failed: ${lastError}`);
      }
      if (attempt < this.maxRetries) {
        await sleep(2 ** (attempt - 1) * 250);
      }
    }

    this.logger.error(`rankings-webhook failed tournament=${tournamentId} after ${this.maxRetries} attempts: ${lastError}`);
    return { ok: false, error: lastError, attempts: this.maxRetries };
  }

  private async attemptPost(body: string): Promise<{ ok: boolean; status?: number; responseBody?: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.rankingsUrl}/tournaments/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      const text = await response.text().catch(() => '');
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        // body wasn't JSON — keep the raw text
      }
      return { ok: response.ok, status: response.status, responseBody: parsed };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
