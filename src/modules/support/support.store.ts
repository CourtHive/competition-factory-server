import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { createHash, randomUUID } from 'node:crypto';
import type { SupportReport } from './support-input';
import type { Pool } from 'pg';

@Injectable()
export class SupportStore {
  constructor(@Inject(PG_POOL) readonly pool: Pool) {}

  async submit(input: SupportReport, userId: string, providerId: string) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ input, providerId })).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`support-provider:${providerId}`]);
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
        count(*) FILTER (WHERE provider_id=$2) AS provider_count
        FROM support_cases WHERE submitted_at > now()-interval '1 hour' AND (reporter_id=$1 OR provider_id=$2)`,
        [userId, providerId],
      );
      if (Number(rate.rows[0].user_count) >= 3 || Number(rate.rows[0].provider_count) >= 20)
        throw new HttpException('Report limit reached', 429);
      const result = await client.query(
        `INSERT INTO support_cases
        (reference, reporter_id, provider_id, tournament_id, submission_key, fingerprint, description, evidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          randomUUID(),
          userId,
          providerId,
          input.tournamentId ?? null,
          input.submissionKey,
          fingerprint,
          input.description,
          input.evidence,
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

  async list(offset = 0) {
    const { rows } = await this.pool.query(
      `SELECT reference, submitted_at, expires_at, send_state, alert_state,
      resolution IS NOT NULL AS has_resolution FROM support_cases WHERE expires_at > now()
      ORDER BY submitted_at DESC, reference LIMIT 50 OFFSET $1`,
      [offset],
    );
    return { reports: rows, nextOffset: rows.length === 50 ? offset + 50 : null };
  }

  async resolve(reference: string, text: string, author: string) {
    const { rows } = await this.pool.query(
      `UPDATE support_cases SET resolution=$2, resolution_author=$3,
      resolution_key=COALESCE(resolution_key,$4), send_state='pending', send_after=now()
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
