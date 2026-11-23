import { globalState, tools } from 'tods-competition-factory';
import { supportsPhysicalFootprint } from '../../storage/postgres/physicalFootprintReader';
import { recordRevision } from '../../storage/postgres/recordRevision';
import type { FootprintLocality } from './footprintLocality';

type Methods = Parameters<typeof tools.getMutationFootprint>[0]['methods'];

/** Observe one access per fetched tournament, including a read followed by a refused queue. */
export function observeQueueRead(
  observer: FootprintLocality,
  ids: string[],
  methods: Methods,
  records?: Record<string, object>,
) {
  for (const [id, record] of Object.entries(records ?? {})) {
    let eligible: boolean | undefined;
    let drawIds: string[] | undefined;
    if (ids.length !== 1)
      eligible = false; // The physical reader takes one tournament.
    else if (Array.isArray(methods) && methods.length && methods.length <= 128) {
      try {
        const footprint = tools.getMutationFootprint({
          methods,
          tournamentId: id,
          activeTournamentId: id,
          outcomePipeline: globalState.getOutcomePipeline(),
        });
        if (!footprint.tournament) drawIds = footprint.drawIds;
        eligible = supportsPhysicalFootprint({ tournamentId: id, footprint });
      } catch {
        // Opaque or malformed directives remain in the unknown denominator; telemetry cannot refuse a queue.
      }
    }
    observer.observeAccess({
      kind: 'queue',
      route: 'queue',
      tournamentId: id,
      drawIds,
      eligible,
      version: recordRevision(record),
    });
  }
}
