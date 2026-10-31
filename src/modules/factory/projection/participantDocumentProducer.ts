import { readModel } from 'tods-competition-factory';
import { randomUUID } from 'node:crypto';

import type { IProjectionOutboxStorage, ProjectionDelta, SnapshotRequest } from 'src/storage/interfaces';
import { TABLE_PUBLIC_PARTICIPANTS, TABLE_TOURNAMENTS } from './projectionConstants';
import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import type { DrainResult } from './snapshotProducer';
import {
  attachedParticipantPolicy,
  publicParticipantPrivacyPolicy,
} from '../functions/public/participantPrivacyPolicy';

export const DOCUMENTS_TOPIC = 'participant_documents';

/**
 * Build the public participant documents that participant changes requested (migration 057;
 * Mentat/planning/PUBLIC_VIEWS_PRIVACY_PLACEMENT.md, W3), off the tournament lock and off CFS's event loop.
 *
 * The same mechanism as `drainSnapshotRequests`: each request is served from the STORED record, and the span is
 * committed through the outbox's fence, only if `tournaments.updated_at` is still the value read, in the transaction
 * that deletes the request. A failed build stays a durable request, counted for retry and for the alert.
 */
export async function drainParticipantDocumentRequests(
  outbox: IProjectionOutboxStorage,
  { limit = 25, maxAttempts = 5 }: { limit?: number; maxAttempts?: number } = {},
): Promise<DrainResult> {
  const result: DrainResult = { examined: 0, enqueued: 0, changed: 0, missing: 0, failed: 0 };
  const requests = (await outbox.pendingParticipantDocumentRequests(limit)).filter(
    (request) => request.attempts < maxAttempts,
  );

  for (const request of requests) {
    result.examined += 1;
    try {
      const outcome = await serve(outbox, request);
      result[outcome] += 1;
    } catch (err: any) {
      result.failed += 1;
      await outbox.recordParticipantDocumentFailure(request.tournamentId, err?.message ?? String(err));
    }
  }
  return result;
}

async function serve(outbox: IProjectionOutboxStorage, request: SnapshotRequest) {
  const { tournamentId, requestedAt } = request;
  const source = await outbox.readForProjection(tournamentId);
  if (!source) {
    return outbox.completeParticipantDocuments({ tournamentId, requestedAt, updatedAt: '', deltas: [] });
  }
  const deltas = await asyncGlobalState.runWithInstanceState(async () =>
    buildParticipantDocumentDeltas({
      tournamentRecord: source.tournamentRecord,
      snapshotId: randomUUID(),
      source: request.source ?? 'deferred',
    }),
  );
  return outbox.completeParticipantDocuments({ tournamentId, requestedAt, updatedAt: source.updatedAt, deltas });
}

/**
 * The privacy policy a tournament's documents are built under: the one attached to the record. A provider's newer
 * policy is never applied here (CA 2026-10-30: not retroactive; attaching it to a tournament is the optional task).
 * A record with none gets the strict public default, never the provider's current settings and never an unfiltered
 * document.
 */
export function documentPolicy(tournamentRecord: any): any {
  return attachedParticipantPolicy(tournamentRecord) ?? publicParticipantPrivacyPolicy();
}

/**
 * A whole-tournament span that replaces the tournament's documents: `snapshot_begin` purges only
 * `public_participants` for the tournament, then one upsert per competitor, then `snapshot_end`. A removed participant
 * emits nothing, which is why the purge is needed; the purge scope is the documents table alone, so the tournament's
 * other read rows are untouched.
 */
export function buildParticipantDocumentDeltas({
  tournamentRecord,
  snapshotId,
  source,
}: {
  tournamentRecord: any;
  snapshotId: string;
  source: string;
}): ProjectionDelta[] {
  const tournamentId = tournamentRecord?.tournamentId;
  if (!tournamentId) return [];

  const result = readModel.publicParticipantDocuments({
    policyDefinitions: documentPolicy(tournamentRecord),
    tournamentRecord,
  });
  if (result.error || !result.documents) {
    throw new Error(`public participant documents failed: ${JSON.stringify(result.error)}`);
  }

  const body: ProjectionDelta[] = result.documents.map((document) => {
    const row = readModel.publicParticipantRow({ tournamentId, document });
    return {
      tournamentId,
      op: 'upsert',
      table: TABLE_PUBLIC_PARTICIPANTS,
      key: { tournament_id: tournamentId, participant_id: row.participant_id },
      row,
      topic: DOCUMENTS_TOPIC,
      snapshotId,
    };
  });

  return [
    {
      tournamentId,
      op: 'snapshot_begin',
      table: TABLE_TOURNAMENTS,
      key: { snapshotId },
      row: { tables: [TABLE_PUBLIC_PARTICIPANTS], source },
      topic: DOCUMENTS_TOPIC,
    },
    ...body,
    {
      tournamentId,
      op: 'snapshot_end',
      table: TABLE_TOURNAMENTS,
      key: { snapshotId },
      row: { deltaCount: body.length, source },
      topic: DOCUMENTS_TOPIC,
    },
  ];
}
