import { commandTransaction } from './commandTransaction';
import { PG_POOL } from './postgres.config';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/** Hash the client intent BEFORE server-owned attribution/time stamping. Transport metadata is excluded. */
export function commandFingerprint(payload: any): string {
  const sorted = (value: any): any =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])]),
          )
        : value;
  return createHash('sha256')
    .update(
      JSON.stringify(
        sorted({
          tournamentIds: payload.tournamentIds ?? [payload.tournamentId].filter(Boolean),
          methods: payload.methods,
          rollbackOnError: payload.rollbackOnError ?? false,
        }),
      ),
    )
    .digest('hex');
}

@Injectable()
export class CommandReceipts {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Called INSIDE the tournament lock: the commit must precede releasing that lock. */
  async execute(payload: any, apply: () => Promise<any>): Promise<any> {
    const { commandId, commandActor, commandFingerprint: fingerprint } = payload;
    if (
      typeof commandId !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(commandId) ||
      typeof commandActor !== 'string' ||
      !commandActor ||
      commandActor.length > 256 ||
      typeof fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(fingerprint)
    )
      throw new BadRequestException('Invalid durable command identity');
    const client = await this.pool.connect();
    const effects: Array<() => Promise<void>> = [];
    let result: any;
    try {
      await client.query('BEGIN');
      // Across processes, serialize duplicate keys until either commit or rollback. Hash collisions
      // only serialize unrelated commands; receipt identity is still the full actor/key pair.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([commandActor, commandId]),
      ]);
      const prior = await client.query(
        'SELECT fingerprint, result FROM command_receipts WHERE actor = $1 AND command_id = $2',
        [commandActor, commandId],
      );
      if (prior.rows.length) {
        if (prior.rows[0].fingerprint !== fingerprint)
          throw new ConflictException('Command ID reused for different intent');
        result = { ...prior.rows[0].result, deduplicated: true };
      } else {
        result = await commandTransaction.run({ pool: this.pool, client, afterCommit: effects }, apply);
        if (!result?.success || result.error) {
          await client.query('ROLLBACK');
          if (result?.retryable) throw new ServiceUnavailableException('Command could not be committed');
          return result;
        }
        result = { ...result, commandId, durableReceipt: true };
        await client.query(
          'INSERT INTO command_receipts (actor, command_id, fingerprint, result) VALUES ($1, $2, $3, $4)',
          [commandActor, commandId, fingerprint, JSON.stringify(result)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        Logger.error(`Durable command rollback failed: ${String(rollbackError)}`, 'CommandReceipts');
      }
      throw error;
    } finally {
      client.release();
    }
    // A lost connection during COMMIT is uncertain. No response is acknowledged; the next send
    // checks the durable receipt. Effects only run after a known successful commit.
    for (const effect of effects) await effect();
    return result;
  }
}

export function runDurableCommand(
  payload: any,
  receipts: CommandReceipts | undefined,
  apply: () => Promise<any>,
): Promise<any> {
  if (payload?.commandId === undefined) return apply();
  if (!receipts) throw new Error('Durable command storage unavailable');
  return receipts.execute(payload, apply);
}
