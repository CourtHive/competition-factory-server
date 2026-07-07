import { executionQueue } from './executionQueue';

// types
import type { ITournamentProvisionerStorage, IProviderStorage } from 'src/storage/interfaces';
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
  tournamentProvisionerStorage?: ITournamentProvisionerStorage,
  providerStorage?: IProviderStorage,
) {
  const hasLegacyWrapper = payload?.params && !payload?.matchUpId;
  const flat = hasLegacyWrapper ? payload.params : payload ?? {};
  const { tournamentId, ...params } = flat;

  const methods = [{ method: 'setMatchUpStatus', params }];

  // Identity/source/correlation live on the top-level payload (the controller
  // stamps them); carry them onto the executionQueue payload so the audit hook
  // records the authenticated actor and the broadcast carries identity.
  const eqPayload = {
    tournamentId,
    methods,
    userId: payload?.userId,
    userEmail: payload?.userEmail,
    source: payload?.source,
    auditSource: payload?.auditSource,
    provisioner: payload?.provisioner,
    ackId: payload?.ackId,
    tmxVersion: payload?.tmxVersion,
    factoryVersion: payload?.factoryVersion,
    timestamp: payload?.timestamp,
  };

  return await executionQueue(eqPayload, services, storage, auditService, tournamentProvisionerStorage, providerStorage);
}
