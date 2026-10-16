import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';

interface CommandTransaction {
  pool: Pool;
  client: PoolClient;
  afterCommit: Array<() => Promise<void>>;
}
export const commandTransaction = new AsyncLocalStorage<CommandTransaction>();

/** Only borrow the connection belonging to this storage pool, within this request. */
export function commandClient(pool: Pool): PoolClient | undefined {
  const transaction = commandTransaction.getStore();
  return transaction?.pool === pool ? transaction.client : undefined;
}

/** External effects must not escape a rolled-back durable command. */
export async function afterCommandCommit(effect: () => Promise<void>): Promise<void> {
  const transaction = commandTransaction.getStore();
  if (transaction) transaction.afterCommit.push(effect);
  else await effect();
}
