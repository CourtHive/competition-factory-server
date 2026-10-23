import 'core-js/actual/array/to-sorted';
import 'dotenv/config';

// Registers the factory's per-request state provider and global methods, exactly as CFS does at boot; the span is
// built by the same `buildSnapshotDeltas` CFS uses inline, so the two cannot diverge.
import './modules/factory/engines/getMutationEngine';

import { PostgresProjectionOutboxStorage } from './storage/postgres/postgres-projection-outbox.storage';
import { drainSnapshotRequests } from './modules/factory/projection/snapshotProducer';
import { getPostgresConfig } from './storage/postgres/postgres.config';
import { attachPoolErrorHandler } from './storage/pool-error-handler';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Projection-Producer: builds the read-model snapshot spans wholesale saves request in deferred mode
 * (`PROJECTION_SNAPSHOT_MODE=deferred`), in its own process so the build never runs on CFS's event loop
 * (Mentat/planning/CFS_LARGE_SAVES.md §10). Idle, and harmless, while CFS runs inline.
 *
 * ONE instance: a session advisory lock is held for the life of the process; a second instance waits for it. Two
 * producers would only race the fence (which keeps the result correct), but would double the work.
 */
const logger = new Logger('ProjectionProducer');
const POLL_MS = Number(process.env.PROJECTION_PRODUCER_POLL_MS) || 1000;
const BATCH = Number(process.env.PROJECTION_PRODUCER_BATCH) || 25;
const SINGLETON_KEY = 'courthive:projection-snapshot-producer';

let stopping = false;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function holdSingletonLock(pool: Pool) {
  const client = await pool.connect();
  while (!stopping) {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS held', [
      SINGLETON_KEY,
    ]);
    if (rows[0]?.held) return client;
    logger.warn('another Projection-Producer holds the lock; waiting');
    await sleep(10_000);
  }
  client.release();
  return undefined;
}

async function run() {
  const pool = attachPoolErrorHandler(new Pool(getPostgresConfig()), 'projection-producer');
  const outbox = new PostgresProjectionOutboxStorage(pool);
  if (!outbox.isEnabled) logger.warn('PROJECTION_OUTBOX_ENABLED is not true: nothing will be produced');

  const lockClient = await holdSingletonLock(pool);
  if (!lockClient) return;
  logger.log(`started (poll ${POLL_MS} ms, batch ${BATCH})`);

  while (!stopping) {
    try {
      const result = outbox.isEnabled ? await drainSnapshotRequests(outbox, { limit: BATCH }) : undefined;
      if (result?.examined) logger.log(`drained ${JSON.stringify(result)}`);
      if (!result?.examined) await sleep(POLL_MS);
    } catch (err: any) {
      logger.error(`drain failed: ${err?.message ?? String(err)}`);
      await sleep(POLL_MS);
    }
  }
  lockClient.release();
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

run().catch((err) => {
  logger.error(`fatal: ${err?.message ?? String(err)}`);
  process.exit(1);
});
