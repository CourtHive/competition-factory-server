/**
 * A REFUSED QUEUE IS REPORTED AS ROLLED BACK. The server runs the engine with rollback off and saves a queue only when
 * it succeeds; a refused queue's records are discarded with the request. Nothing of a refused queue is stored, so
 * whatever `rollbackOnError` the caller sent, its result says what a rolled-back engine says:
 * - `rolledBack: true`, and no `committed`;
 * - no results for the directives before the refusal: they were not stored;
 * - a refused bulk directive's per-item `results`, in order: a refused item keeps its `error`, and an item that had
 *   succeeded carries `rolledBack: true` in place of `success`.
 *
 * The rest of the refusal (`error`, `info`, `context`, ...) is returned as the engine gave it. A successful result is
 * returned unchanged.
 */
export function refusedAsRolledBack<T extends Record<string, any>>(result: T): T {
  if (!result?.error) return result;
  const refusal: Record<string, any> = { ...result };
  for (const key of ['committed', 'results', 'rolledBack']) delete refusal[key];
  // the refused directive is the only entry with an error; a bulk one carries its own per-item results
  const refused = Array.isArray(result.results) ? result.results.find((entry) => entry?.error) : undefined;
  const items = Array.isArray(refused?.results) ? refused.results : undefined;
  return { ...refusal, ...(items ? { results: items.map(rolledBackItem) } : {}), rolledBack: true } as unknown as T;
}

function rolledBackItem(item: unknown) {
  if (!item || typeof item !== 'object' || !('success' in item)) return item;
  const identifiers: Record<string, unknown> = { ...item };
  delete identifiers.success;
  delete identifiers.warnings;
  return { ...identifiers, rolledBack: true };
}
