import { PoolClient } from 'pg';

export const PRODUCER_SINGLETON_KEY = 'courthive:projection-snapshot-producer';

export async function tryAcquireProducerLock(client: PoolClient, key = PRODUCER_SINGLETON_KEY): Promise<boolean> {
  const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS held', [key]);
  return rows[0]?.held === true;
}

/**
 * Names the session holding the producer lock. The holder can be on another HOST: on 2026-10-29 mentat's dev producer
 * (pointed at nest's database) held prod's lock for six hours, and the only log line said "another Projection-Producer
 * holds the lock". `client_addr` is what identifies the host; it is null for a unix-socket connection on the DB host.
 *
 * A bigint advisory lock is stored as classid (high 32 bits) and objid (low 32 bits), with objsubid 1.
 */
export async function describeProducerLockHolder(
  client: PoolClient,
  key = PRODUCER_SINGLETON_KEY,
): Promise<string | undefined> {
  const { rows } = await client.query(
    `WITH k AS (SELECT hashtextextended($1, 0) AS v)
     SELECT a.pid, host(a.client_addr) AS client_addr, a.application_name, a.backend_start
       FROM k, pg_locks l JOIN pg_stat_activity a USING (pid)
      WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
        AND l.classid::bigint = (k.v >> 32) & 4294967295
        AND l.objid::bigint = k.v & 4294967295`,
    [key],
  );
  const holder = rows[0];
  if (!holder) return undefined;
  const from = holder.client_addr ?? 'local socket';
  const app = holder.application_name ? ` "${holder.application_name}"` : '';
  const since = holder.backend_start instanceof Date ? holder.backend_start.toISOString() : holder.backend_start;
  return `pid ${holder.pid}${app} from ${from}, connected ${since}`;
}
