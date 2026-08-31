import { Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

/**
 * Keeps a dying Postgres connection from killing the process.
 *
 * `pg` surfaces a broken connection as an `'error'` event, and Node's rule for an
 * `'error'` event with **no listener** is to throw. Nothing is above it to catch,
 * so the service exits. There are **two** places that event can fire, and they
 * need separate listeners — which is the part that is easy to get half right:
 *
 * 1. **On the POOL**, for a client that fails while sitting IDLE in it — a
 *    Postgres restart, a failover, an administrative `pg_terminate_backend`, a
 *    dropped route.
 * 2. **On the CLIENT**, for one that is CHECKED OUT via `pool.connect()` and dies
 *    mid-transaction. `pg` emits this on the `Client`, not on the pool, so a
 *    pool-level listener does **not** cover it.
 *
 * Both were measured, not reasoned about. With only the pool listener attached,
 * killing the backend of a client held across a `BEGIN` still exits the process:
 *
 *     Emitted 'error' event on Client instance at:
 *     error: terminating connection due to administrator command
 *
 * With both attached, every combination survives — and the idle case still
 * reaches the pool listener, so nothing is lost by adding the client one.
 *
 * **A try/catch around a query cannot replace this.** The event fires on the
 * connection, not on the query, and for the idle case there is no query to wrap.
 *
 * **It does not swallow anything the caller should see.** An in-flight query on a
 * dead client still rejects with `Client has encountered a connection error and is
 * not queryable`, so a transaction that was mid-flight still fails loudly to the
 * code that issued it. What this changes is only whether the *process* dies too.
 *
 * The logging is deliberate (architectural standard A2 — fail-soft must surface):
 * a swallowed connection error is how a cluster problem becomes invisible.
 *
 * The two listeners say different things on purpose, and the client one is
 * carefully NOT labelled "checked-out". It is attached at connect time and has no
 * way to know whether the client is checked out or idle at the moment it fails —
 * an early draft asserted "checked-out" and was caught printing it for an
 * idle-client kill. So the client listener states only what is certainly true,
 * and the pool listener adds the "idle" fact when it applies. **An idle failure
 * therefore logs BOTH lines for one event**; that is the honest shape, not a bug.
 */
export function attachPoolErrorHandler(pool: Pool, label: string): Pool {
  const logger = new Logger(`PoolErrorHandler:${label}`);

  const report = (headline: string, consequence: string, err: Error): void => {
    logger.error(
      `${headline} on the "${label}" pool: ${err.message}. ${consequence} ` +
        'Repeated occurrences mean the database is restarting, failing over, or unreachable.',
      err.stack,
    );
  };

  pool.on('error', (err: Error) =>
    report('idle client error', 'The client was discarded; the next checkout opens a fresh connection.', err),
  );

  pool.on('connect', (client: PoolClient) =>
    client.on('error', (err: Error) =>
      report(
        'connection error',
        'If a transaction was in flight on this connection it was lost, and its caller sees the rejection.',
        err,
      ),
    ),
  );

  return pool;
}
