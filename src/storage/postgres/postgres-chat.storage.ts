import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  AppendChatMessageInput,
  ChatMessageRecord,
  IChatStorage,
} from '../interfaces/chat-storage.interface';
import { PG_POOL } from './postgres.config';

const DEFAULT_BACKFILL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 200;
const ADMIN_DEFAULT_LIMIT = 400;

const SELECT_COLS = `seq, tournament_id, provider_id, provider_abbr, tournament_name,
  user_name, message, client_msg_id, is_admin, created_at`;

@Injectable()
export class PostgresChatStorage implements IChatStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async appendMessage(
    input: AppendChatMessageInput,
  ): Promise<{ record?: ChatMessageRecord; error?: string }> {
    try {
      const result = await this.pool.query(
        `INSERT INTO chat_messages
           (tournament_id, provider_id, provider_abbr, tournament_name, user_name, message, client_msg_id, is_admin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_COLS}`,
        [
          input.tournamentId,
          input.providerId ?? null,
          input.providerAbbr ?? null,
          input.tournamentName ?? null,
          input.userName,
          input.message,
          input.clientMsgId ?? null,
          input.isAdmin ?? false,
        ],
      );
      return { record: mapRow(result.rows[0]) };
    } catch (err: any) {
      return { error: err?.message ?? 'append failed' };
    }
  }

  async recentMessages(params: {
    tournamentId: string;
    sinceMs?: number;
    limit?: number;
  }): Promise<{ records?: ChatMessageRecord[]; error?: string }> {
    const sinceMs = params.sinceMs ?? DEFAULT_BACKFILL_MS;
    const limit = params.limit ?? DEFAULT_LIMIT;
    try {
      // Take the most-recent `limit` within the window (DESC), then re-order
      // ascending so the client renders oldest→newest.
      const result = await this.pool.query(
        `SELECT * FROM (
           SELECT ${SELECT_COLS} FROM chat_messages
           WHERE tournament_id = $1 AND created_at > now() - ($2::bigint * interval '1 millisecond')
           ORDER BY seq DESC
           LIMIT $3
         ) recent ORDER BY seq ASC`,
        [params.tournamentId, sinceMs, limit],
      );
      return { records: result.rows.map(mapRow) };
    } catch (err: any) {
      return { error: err?.message ?? 'recentMessages failed' };
    }
  }

  async messagesSince(params: {
    tournamentId: string;
    afterSeq: number;
    limit?: number;
  }): Promise<{ records?: ChatMessageRecord[]; error?: string }> {
    const limit = params.limit ?? DEFAULT_LIMIT;
    try {
      const result = await this.pool.query(
        `SELECT ${SELECT_COLS} FROM chat_messages
         WHERE tournament_id = $1 AND seq > $2
         ORDER BY seq ASC
         LIMIT $3`,
        [params.tournamentId, params.afterSeq, limit],
      );
      return { records: result.rows.map(mapRow) };
    } catch (err: any) {
      return { error: err?.message ?? 'messagesSince failed' };
    }
  }

  async recentAcrossTournaments(params: {
    sinceMs?: number;
    limit?: number;
  }): Promise<{ records?: ChatMessageRecord[]; error?: string }> {
    const sinceMs = params.sinceMs ?? DEFAULT_BACKFILL_MS;
    const limit = params.limit ?? ADMIN_DEFAULT_LIMIT;
    try {
      const result = await this.pool.query(
        `SELECT * FROM (
           SELECT ${SELECT_COLS} FROM chat_messages
           WHERE created_at > now() - ($1::bigint * interval '1 millisecond')
           ORDER BY seq DESC
           LIMIT $2
         ) recent ORDER BY seq ASC`,
        [sinceMs, limit],
      );
      return { records: result.rows.map(mapRow) };
    } catch (err: any) {
      return { error: err?.message ?? 'recentAcrossTournaments failed' };
    }
  }

  async pruneOlderThan(params: { olderThanMs: number }): Promise<{ deleted?: number; error?: string }> {
    try {
      const result = await this.pool.query(
        `DELETE FROM chat_messages WHERE created_at < now() - ($1::bigint * interval '1 millisecond')`,
        [params.olderThanMs],
      );
      return { deleted: result.rowCount ?? 0 };
    } catch (err: any) {
      return { error: err?.message ?? 'prune failed' };
    }
  }
}

function mapRow(row: any): ChatMessageRecord {
  return {
    seq: Number(row.seq),
    tournamentId: row.tournament_id,
    providerId: row.provider_id ?? undefined,
    providerAbbr: row.provider_abbr ?? undefined,
    tournamentName: row.tournament_name ?? undefined,
    userName: row.user_name,
    message: row.message,
    clientMsgId: row.client_msg_id ?? undefined,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}
