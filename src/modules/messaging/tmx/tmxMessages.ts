import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';
import { Logger } from '@nestjs/common';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { AuditService } from 'src/modules/audit/audit.service';

const logger = new Logger('TmxMessages');

/** The reply to an executionQueue request, correlated by the client's `ackId`. */
export interface ExecutionQueueAck {
  ackId?: string;
  success?: boolean;
  error?: any;
  context?: any;
  info?: any;
  stack?: any;
  tournamentIds?: string[];
}

/**
 * Transport-free message handlers. Each returns the reply rather than sending
 * it, so the caller decides how the reply travels — a socket `ack` event today,
 * an HTTP response body on a request/response transport.
 */
export const tmxMessages = {
  executionQueue: async ({
    payload,
    services,
    storage,
    auditService,
  }: {
    payload: any;
    services: any;
    storage: TournamentStorageService;
    auditService?: AuditService;
  }): Promise<{ ack: ExecutionQueueAck; publicNotices?: any[] }> => {
    const ackId = payload?.ackId;
    const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

    try {
      const result = await executionQueue(payload, services, storage, auditService);
      const { publicNotices, ...mutationResult } = result;

      const ack: ExecutionQueueAck = mutationResult.error
        ? {
            ackId,
            error: mutationResult.error,
            ...(mutationResult.context && { context: mutationResult.context }),
            ...(mutationResult.info && { info: mutationResult.info }),
            ...(mutationResult.stack && { stack: mutationResult.stack }),
            ...(mutationResult.tournamentIds && { tournamentIds: mutationResult.tournamentIds }),
          }
        : {
            ackId,
            success: mutationResult.success,
          };
      return { ack, publicNotices };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Unexpected error in executionQueue message: ${message}`);
      return { ack: { ackId, error: 'Server error', tournamentIds } };
    }
  },
};
