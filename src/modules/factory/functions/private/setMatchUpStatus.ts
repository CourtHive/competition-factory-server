import { executionQueue } from './executionQueue';

// types
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { AuditService } from 'src/modules/audit/audit.service';

/**
 * Thin score-relay-style entry point. score-relay (and any other
 * matchUpId-only producer, e.g. an external scoring API) doesn't know the
 * drawId. executionQueue resolves drawId/eventId against the lock-acquired
 * tournament record before dispatching — avoids a redundant pre-lock storage
 * fetch.
 *
 * auditService + the identity/source fields are forwarded so this path is
 * audited and broadcast identically to the socket and /factory paths. Omitting
 * auditService here is what previously left API-submitted scores out of
 * audit_log entirely.
 */
export async function setMatchUpStatus(
  payload: any,
  services: any,
  storage: TournamentStorageService,
  auditService?: AuditService,
) {
  const { tournamentId, methods } = scoreCommand(payload);

  // Identity/source/correlation live on the top-level payload (the controller
  // stamps them); carry them onto the executionQueue payload so the audit hook
  // records the authenticated actor and the broadcast carries identity.
  // The command fields make the score durable: with a commandId, executionQueue answers a resend from its receipt
  // instead of applying the score again. commandActor and commandFingerprint are the controller's, never the client's.
  const eqPayload = {
    tournamentId,
    methods,
    userId: payload?.userId,
    userEmail: payload?.userEmail,
    source: payload?.source,
    auditSource: payload?.auditSource,
    ackId: payload?.ackId,
    tmxVersion: payload?.tmxVersion,
    factoryVersion: payload?.factoryVersion,
    timestamp: payload?.timestamp,
    commandId: payload?.commandId,
    commandActor: payload?.commandActor,
    commandFingerprint: payload?.commandFingerprint,
  };

  const result = await executionQueue(eqPayload, services, storage, auditService);
  // The methods AS EXECUTED: executionQueue backfills drawId/eventId onto these params in place. The controller
  // broadcasts them to connected TMX clients, which cannot apply a setMatchUpStatus without its drawId — broadcasting
  // the request body instead left every open TMX failing ERR_MISSING_DRAWDEF on an integrator's matchUpId-only score.
  return { ...result, methods };
}

// Lifted onto the executionQueue payload above, so none of them is a setMatchUpStatus param. In a flat body they sit
// beside the score fields and used to ride into the params with them.
const TRANSPORT_FIELDS = [
  'userId',
  'userEmail',
  'source',
  'auditSource',
  'ackId',
  'tmxVersion',
  'factoryVersion',
  'timestamp',
  'commandId',
  'commandUser',
  'commandActor',
  'commandFingerprint',
];

/**
 * What a score request asks for: the tournament and the one setMatchUpStatus it applies, from either the flat body or
 * the legacy `{ params }` wrapper. The controller fingerprints this for a durable command and setMatchUpStatus executes
 * it, so a resend hashes exactly what ran. Server-stamped fields are excluded: they would make two identical resends
 * hash differently.
 */
export function scoreCommand(payload: any): { tournamentId: string; methods: any[] } {
  const hasLegacyWrapper = payload?.params && !payload?.matchUpId;
  const flat = hasLegacyWrapper ? payload.params : (payload ?? {});
  const { tournamentId, ...rest } = flat;
  const params = Object.fromEntries(Object.entries(rest).filter(([key]) => !TRANSPORT_FIELDS.includes(key)));
  return { tournamentId, methods: [{ method: 'setMatchUpStatus', params }] };
}
