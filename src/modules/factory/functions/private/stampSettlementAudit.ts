import type { DrawDefinition, Tournament } from 'tods-competition-factory';

const SETTLEMENT_METHOD = 'settleRotatingPartnerResult';

type Directive = { method: string; params?: Record<string, unknown> };

/** Called under the tournament lock, after identity verification and before factory execution. */
export function stampSettlementAudit({
  methods,
  tournamentRecords,
  actor,
  recordedAt,
}: {
  methods: Directive[];
  tournamentRecords: Record<string, Tournament>;
  actor: unknown;
  recordedAt: string;
}): { error?: string; stamped: boolean } {
  const settlements = methods.filter((directive) => directive?.method === SETTLEMENT_METHOD);
  if (!settlements.length) return { stamped: false };
  if (typeof actor !== 'string' || !actor.trim())
    return { error: 'Authenticated actor required for settlement', stamped: false };
  for (const directive of settlements) {
    const params = directive.params;
    if (!params || typeof params !== 'object' || Array.isArray(params))
      return { error: 'Invalid settlement parameters', stamped: false };
    const draws = Object.values(tournamentRecords)
      .filter((record) => !params.tournamentId || record.tournamentId === params.tournamentId)
      .flatMap((record) => (record.events ?? []).flatMap((event) => event.drawDefinitions ?? []))
      .filter((draw) => draw.drawId === params.drawId);
    if (draws.length !== 1) return { error: 'Settlement must identify exactly one loaded draw', stamped: false };
    // A read projection supports the new attribute before the factory release is published.
    const history = (
      draws[0] as DrawDefinition & {
        competitionSettlements?: { requestId: string; recordedAt: string }[];
      }
    ).competitionSettlements;
    const prior = Array.isArray(history) ? history.find((record) => record.requestId === params.requestId) : undefined;
    // Preserve the timestamp across retries. Factory checks actor and all other intent fields;
    // reusing another operator's requestId still conflicts, rather than borrowing their identity.
    params.recordedBy = actor;
    params.recordedAt = prior?.recordedAt ?? recordedAt;
  }
  return { stamped: true };
}

/** Build receipts from the successfully persisted state, never from client-asserted fields. */
export function settlementAuditReceipts(methods: Directive[], tournamentRecords: Record<string, Tournament>) {
  const requests = methods.filter((directive) => directive.method === SETTLEMENT_METHOD);
  return Object.values(tournamentRecords).flatMap((record) =>
    (record.events ?? []).flatMap((event) =>
      (event.drawDefinitions ?? []).flatMap((draw) => {
        const requested = new Set(
          requests
            .filter(
              (directive) =>
                directive.params?.drawId === draw.drawId &&
                (!directive.params?.tournamentId || directive.params.tournamentId === record.tournamentId),
            )
            .map((directive) => directive.params?.requestId),
        );
        const history =
          (
            draw as DrawDefinition & {
              competitionSettlements?: {
                requestId: string;
                matchUpId: string;
                recordedBy: string;
                recordedAt: string;
              }[];
            }
          ).competitionSettlements ?? [];
        return history
          .filter((settlement) => requested.has(settlement.requestId))
          .map((settlement) => ({
            tournamentId: record.tournamentId,
            drawId: draw.drawId,
            requestId: settlement.requestId,
            matchUpId: settlement.matchUpId,
            recordedBy: settlement.recordedBy,
            recordedAt: settlement.recordedAt,
          }));
      }),
    ),
  );
}
