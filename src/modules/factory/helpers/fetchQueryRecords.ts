import { tools } from 'tods-competition-factory';

// constants and types
import type { ITournamentStorage, PhysicalFootprintRequest } from 'src/storage/interfaces/tournament-storage.interface';

type QueryStorage = Pick<ITournamentStorage, 'readerForTournament' | 'fetchTournamentRecords'>;
type Records = Awaited<ReturnType<QueryStorage['fetchTournamentRecords']>>;
type Footprint = ReturnType<typeof tools.getQueryFootprint>;
type FetchParams = Parameters<QueryStorage['fetchTournamentRecords']>[0];

// Only plan server-resolved identifiers and scalar action options. The generic query route also accepts
// supplied records, participant sets and computed context; those keep its existing whole-record semantics.
const scalarParams = new Set([
  'tournamentId',
  'eventId',
  'drawId',
  'matchUpId',
  'structureId',
  'drawPosition',
  'participantId',
  'sideNumber',
  'returnParticipants',
  'provisionalPositioning',
  'restrictAdHocRoundParticipants',
  'enforceGender',
]);

export function planQueryRead(
  fetchParams: FetchParams,
  method: string,
  params?: Record<string, unknown>,
): PhysicalFootprintRequest | undefined {
  const ids = fetchParams.tournamentIds ?? [fetchParams.tournamentId];
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string' || !ids[0]) return;
  const tournamentId = ids[0];
  if (
    typeof method !== 'string' ||
    !params ||
    (params.tournamentId !== undefined && params.tournamentId !== tournamentId)
  )
    return;
  const { drawId, eventId } = params;
  if (typeof drawId !== 'string' || !drawId || typeof eventId !== 'string' || !eventId) return;
  if (
    !Object.entries(params).every(
      ([key, value]) =>
        scalarParams.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    )
  )
    return;
  const footprint = tools.getQueryFootprint({
    methods: [{ method, params }],
    tournamentId,
    activeTournamentId: tournamentId,
  });
  if (footprint.tournament) return;
  return { tournamentId, footprint, drawEventIds: { [drawId]: eventId } };
}

export async function fetchQueryRecords(
  storage: QueryStorage,
  fetchParams: FetchParams,
  method: string,
  params?: Record<string, unknown>,
): Promise<Records & { loadedFootprint?: Footprint }> {
  const ids = fetchParams.tournamentIds;
  const id = ids === undefined ? fetchParams.tournamentId : Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;
  const reader = id && storage.readerForTournament?.(id);
  if (reader) {
    const request = planQueryRead(fetchParams, method, params);
    if (request) {
      const read = await reader(request);
      if (read.kind === 'partial') {
        return {
          success: true,
          tournamentRecords: { [request.tournamentId]: read.tournamentRecord },
          loadedFootprint: read.loadedFootprint,
          serverUpdatedAt: { [request.tournamentId]: read.previousServerUpdatedAt },
          fetched: 1,
          notFound: 0,
        };
      }
    }
  }
  return storage.fetchTournamentRecords(fetchParams);
}
