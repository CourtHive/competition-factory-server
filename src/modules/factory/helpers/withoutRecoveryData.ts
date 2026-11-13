// Method results whose before-state is recovery evidence: kept in the durable command receipt, never sent to clients.
const RECOVERY_FIELDS = ['mergeReceipt'];

/** The response a client receives: the receipt row keeps the full result, the ack and any replay of it do not. */
export function withoutRecoveryData<T extends object>(result: T): T {
  const methodResults = (result as { results?: unknown })?.results;
  if (!Array.isArray(methodResults)) return result;
  const results = methodResults.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const kept = { ...(item as Record<string, unknown>) };
    for (const field of RECOVERY_FIELDS) delete kept[field];
    return kept;
  });
  return { ...result, results };
}
