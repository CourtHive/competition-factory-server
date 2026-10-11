import type { Tournament } from 'tods-competition-factory';

/** Temporary 7.11.0 compatibility: the factory still compares audit metadata on retries. */
export function preserveSettlementRetryTime(
  methods: { method?: string; params?: any }[],
  records: Record<string, Tournament>,
) {
  let rewritten = false;
  for (const directive of methods) {
    if (directive.method !== 'settleRotatingPartnerResult' || !directive.params) continue;
    const params = directive.params;
    const draws = Object.values(records)
      .filter((record) => !params.tournamentId || record.tournamentId === params.tournamentId)
      .flatMap((record) => (record.events ?? []).flatMap((event) => event.drawDefinitions ?? []))
      .filter((draw) => draw.drawId === params.drawId);
    if (draws.length !== 1) continue;
    const prior = draws[0].competitionSettlements?.find((settlement) => settlement.requestId === params.requestId);
    if (prior && params.recordedAt !== prior.recordedAt) {
      params.recordedAt = prior.recordedAt;
      rewritten = true;
    }
  }
  return rewritten;
}
