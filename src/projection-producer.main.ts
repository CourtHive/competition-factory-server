import 'core-js/actual/array/to-sorted';
import 'dotenv/config';

// Registers the factory's per-request state provider and global methods, exactly as CFS does at boot; the span is
// built by the same `buildSnapshotDeltas` CFS uses inline, so the two cannot diverge.
import './modules/factory/engines/getMutationEngine';

import { describeProducerLockHolder, tryAcquireProducerLock } from './modules/factory/projection/producerSingletonLock';
import { PostgresProjectionOutboxStorage } from './storage/postgres/postgres-projection-outbox.storage';
import { drainSnapshotRequests } from './modules/factory/projection/snapshotProducer';
import { getPostgresConfig } from './storage/postgres/postgres.config';
import { attachPoolErrorHandler } from './storage/pool-error-handler';
import { Logger } from '@nestjs/common';
import { hostname } from 'node:os';
import { Pool } from 'pg';

/**
 * Projection-Producer: builds the read-model snapshot spans wholesale saves request in deferred mode
 * (`PROJECTION_SNAPSHOT_MODE=deferred`), in its own process so the build never runs on CFS's event loop
 * (Mentat/planning/CFS_LARGE_SAVES.md §10). Idle, and harmless, while CFS runs inline.
 *
 * ONE instance: a session advisory lock is held for the life of the process; a second instance waits for it. Two
 * producers would only race the fence (which keeps the result correct), but would double the work.
 *
 * A producer whose outbox is disabled never takes the lock: it would hold it while producing nothing, and an enabled
 * producer on another host sharing the database would wait behind it indefinitely (prod, 2026-10-29).
 */
const logger = new Logger('ProjectionProducer');
const POLL_MS = Number(process.env.PROJECTION_PRODUCER_POLL_MS) || 1000;
const BATCH = Number(process.env.PROJECTION_PRODUCER_BATCH) || 25;

let stopping = false;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function holdSingletonLock(pool: Pool) {
  const client = await pool.connect();
  while (!stopping) {
    if (await tryAcquireProducerLock(client)) return client;
    const holder = await describeProducerLockHolder(client).catch(() => undefined);
    logger.warn(`another Projection-Producer holds the lock (${holder ?? 'holder not visible'}); waiting`);
    await sleep(10_000);
  }
  client.release();
  return undefined;
}

async function idleUntilStopped() {
  while (!stopping) await sleep(POLL_MS);
}

async function run() {
  // The application_name names the host in pg_stat_activity, so a holder on another machine is identifiable.
  const config = { ...getPostgresConfig(), application_name: `projection-producer@${hostname()}` };
  const pool = attachPoolErrorHandler(new Pool(config), 'projection-producer');
  const outbox = new PostgresProjectionOutboxStorage(pool);
  if (!outbox.isEnabled) {
    logger.warn('PROJECTION_OUTBOX_ENABLED is not true: nothing will be produced; not taking the producer lock');
    await idleUntilStopped();
    await pool.end();
    return;
  }

  const lockClient = await holdSingletonLock(pool);
  if (!lockClient) return;
  logger.log(`started (poll ${POLL_MS} ms, batch ${BATCH})`);

  while (!stopping) {
    try {
      const result = await drainSnapshotRequests(outbox, { limit: BATCH });
      if (result.examined) logger.log(`drained ${JSON.stringify(result)}`);
      if (!result.examined) await sleep(POLL_MS);
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
