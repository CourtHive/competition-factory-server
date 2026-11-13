// Method results whose before-state is recovery evidence: kept in the durable command receipt, never sent to clients.
const RECOVERY_FIELDS = ['mergeReceipt'];

/** The response a client receives: the receipt row keeps the full result, the ack and any replay of it do not. */
export function withoutRecoveryData<T extends { results?: unknown }>(result: T): T {
  if (!Array.isArray(result?.results)) return result;
  const results = result.results.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const kept = { ...(item as Record<string, unknown>) };
    for (const field of RECOVERY_FIELDS) delete kept[field];
    return kept;
  });
  return { ...result, results };
}
