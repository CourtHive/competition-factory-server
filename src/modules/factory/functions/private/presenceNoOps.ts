/**
 * Methods that report a request for the state already held as `changed: false`. Named explicitly, so a method
 * that returns a `changed` field for any other reason is never filtered.
 */
const NO_OP_REPORTING_METHODS = new Set(['setParticipantCheckInState']);

/**
 * The methods every other copy of the record must apply: the executed methods without the directives that wrote
 * nothing here.
 *
 * A desired-state intention that found its state already held appended nothing on the server. Replayed elsewhere
 * it is not harmless: a desk that missed the winning write would apply it against its stale copy and record an
 * attestation the server never held (planning/TMX_CHECK_IN_INTENTS_AND_RECONNECT.md, "No-op propagation rule").
 * So it reaches neither the sender's `appliedMethods`, nor the broadcast, nor the mirror.
 *
 * Fails toward recovery: a reporting directive is kept only when its own result says `changed: true`. A result
 * that is missing or out of step drops it, and a copy that misses a real change is caught by the staleness probe;
 * a replayed no-op would be caught by nothing.
 */
export function withoutReportedNoOps(methods: any[], results?: any[]): { methods: any[]; dropped: number } {
  const kept = methods.filter((directive, index) => {
    if (!NO_OP_REPORTING_METHODS.has(directive?.method)) return true;
    const result = results?.[index];
    return result?.methodName === directive.method && result?.changed === true;
  });
  return { methods: kept, dropped: methods.length - kept.length };
}
