import { describeProducerLockHolder, tryAcquireProducerLock } from './producerSingletonLock';
import { getPostgresConfig } from 'src/storage/postgres/postgres.config';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';

// Against a real Postgres: the holder lookup decodes the bigint key into classid/objid, which a mock cannot check.
// Each run uses its own key so a producer on the same database is never touched.
describe('producer singleton lock', () => {
  const key = `test:producer-lock:${randomUUID()}`;
  let pool: Pool;
  let holder: PoolClient;
  let waiter: PoolClient;

  beforeAll(async () => {
    pool = new Pool({ ...getPostgresConfig(), application_name: 'producer-lock-spec' });
    holder = await pool.connect();
    waiter = await pool.connect();
  });

  afterAll(async () => {
    holder?.release();
    waiter?.release();
    await pool?.end();
  });

  it('names nobody while the lock is free', async () => {
    expect(await describeProducerLockHolder(waiter, key)).toBeUndefined();
  });

  it('grants one session and names it to the other', async () => {
    expect(await tryAcquireProducerLock(holder, key)).toBe(true);
    expect(await tryAcquireProducerLock(waiter, key)).toBe(false);

    const { rows } = await holder.query('SELECT pg_backend_pid() AS pid');
    const described = await describeProducerLockHolder(waiter, key);
    expect(described).toContain(`pid ${rows[0].pid} "producer-lock-spec" from `);
  });

  it('does not name the holder of a different key', async () => {
    expect(await describeProducerLockHolder(waiter, `${key}:other`)).toBeUndefined();
  });

  it('frees the lock when the holding session releases it', async () => {
    await holder.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
    expect(await tryAcquireProducerLock(waiter, key)).toBe(true);
    await waiter.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
  });
});
