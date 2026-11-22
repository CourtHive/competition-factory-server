import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { createHash, randomUUID } from 'node:crypto';
import type { SupportKind, SupportReport } from './support-input';
import type { Pool } from 'pg';

/** Where a case belongs: a provider, or the platform when no provider is selected. */
export type SupportTarget = { scope: 'provider'; providerId: string } | { scope: 'platform'; providerId?: undefined };
export type SupportListFilter = { scope?: SupportTarget['scope']; kind?: SupportKind };

// Hourly intake ceilings: per provider, and one shared by every platform-scoped case.
const PROVIDER_HOURLY_LIMIT = 200;
const PLATFORM_HOURLY_LIMIT = 200;

@Injectable()
export class SupportStore {
  constructor(@Inject(PG_POOL) readonly pool: Pool) {}

  async submit(input: SupportReport, userId: string, target: SupportTarget) {
    const providerId = target.providerId ?? null;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ input, providerId, scope: target.scope }))
      .digest('hex');
    const bucket = target.scope === 'provider' ? `support-provider:${providerId}` : 'support-platform';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [bucket]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`support-user:${userId}`]);
      const prior = await client.query(`SELECT * FROM support_cases WHERE reporter_id=$1 AND submission_key=$2`, [
        userId,
        input.submissionKey,
      ]);
      if (prior.rows[0]) {
        if (new Date(prior.rows[0].expires_at).getTime() <= Date.now()) throw new NotFoundException();
        if (prior.rows[0].fingerprint !== fingerprint) throw new ConflictException('Submission key already used');
        await client.query('COMMIT');
        return prior.rows[0];
      }
      const rate = await client.query(
        `SELECT
        count(*) FILTER (WHERE reporter_id=$1 AND submitted_at > now()-interval '10 minutes') AS user_count,
        count(*) FILTER (WHERE provider_id=$2) AS provider_count,
        count(*) FILTER (WHERE scope='platform') AS platform_count
        FROM support_cases WHERE submitted_at > now()-interval '1 hour'
        AND (reporter_id=$1 OR provider_id=$2 OR scope='platform')`,
        [userId, providerId],
      );
      const { user_count, provider_count, platform_count } = rate.rows[0];
      const scopeCount = target.scope === 'provider' ? Number(provider_count) : Number(platform_count);
      const scopeLimit = target.scope === 'provider' ? PROVIDER_HOURLY_LIMIT : PLATFORM_HOURLY_LIMIT;
      if (Number(user_count) >= 3 || scopeCount >= scopeLimit) throw new HttpException('Report limit reached', 429);
      const result = await client.query(
        `INSERT INTO support_cases
        (reference, reporter_id, provider_id, tournament_id, submission_key, fingerprint, description, evidence,
        scope, kind)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          randomUUID(),
          userId,
          providerId,
          input.tournamentId ?? null,
          input.submissionKey,
          fingerprint,
          input.description,
          input.evidence,
          target.scope,
          input.kind,
        ],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(reference: string) {
    const { rows } = await this.pool.query('SELECT * FROM support_cases WHERE reference=$1 AND expires_at > now()', [
      reference,
    ]);
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  async list(offset = 0, filter: SupportListFilter = {}) {
    const { rows } = await this.pool.query(
      `SELECT reference, kind, scope, provider_id, submitted_at, expires_at, send_state, alert_state,
      resolution IS NOT NULL AS has_resolution FROM support_cases WHERE expires_at > now()
      AND ($2::text IS NULL OR scope=$2) AND ($3::text IS NULL OR kind=$3)
      ORDER BY submitted_at DESC, reference LIMIT 50 OFFSET $1`,
      [offset, filter.scope ?? null, filter.kind ?? null],
    );
    return { reports: rows, nextOffset: rows.length === 50 ? offset + 50 : null };
  }

  async resolve(reference: string, text: string, author: string) {
    const { rows } = await this.pool.query(
      `UPDATE support_cases SET resolution=$2, resolution_author=$3,
      resolution_key=COALESCE(resolution_key,$4), send_after=now(),
      -- A suggestion is acknowledged, never answered by email (CA, 2026-11-22): its resolution is a triage note.
      send_state=CASE WHEN kind='suggestion' THEN 'none' ELSE 'pending' END
      WHERE reference=$1 AND expires_at > now() AND resolution IS NULL RETURNING reference`,
      [reference, text, author, randomUUID()],
    );
    if (!rows.length) {
      const prior = await this.get(reference);
      if (prior.resolution !== text)
        throw new ConflictException('Resolution already recorded; inspect the existing send state');
    }
    return this.get(reference);
  }

  async purge() {
    // Bounded deletes; expired rows are excluded from every read/send even before cleanup completes.
    await this.pool.query(`DELETE FROM support_cases WHERE reference IN
      (SELECT reference FROM support_cases WHERE expires_at <= now() ORDER BY expires_at LIMIT 100)`);
  }
}
