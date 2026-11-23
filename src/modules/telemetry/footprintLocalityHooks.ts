import { supportsPhysicalFootprint } from '../../storage/postgres/physicalFootprintReader';
import { recordRevision } from '../../storage/postgres/recordRevision';
import { planQueryRead } from '../factory/helpers/fetchQueryRecords';
import type { FootprintLocality } from './footprintLocality';

type ReadResult = { tournamentRecords?: Record<string, object>; loadedFootprint?: { drawIds: string[] } };

export function observeQueryRead(
  observer: FootprintLocality,
  ids: string[],
  method: string,
  params: Record<string, unknown> | undefined,
  result: ReadResult,
) {
  let plan: ReturnType<typeof planQueryRead>;
  let eligible: boolean | undefined;
  try {
    plan = planQueryRead({ tournamentIds: ids }, method, params);
    eligible = !!plan && supportsPhysicalFootprint(plan);
  } catch {
    // Keep failed classification separate from a successful physical read.
  }
  for (const [id, record] of Object.entries(result.tournamentRecords ?? {})) {
    const physicalRead = !!result.loadedFootprint;
    observer.observeAccess({
      kind: 'read',
      route: 'privateQuery',
      tournamentId: id,
      eligible: physicalRead || eligible,
      physicalRead,
      drawIds:
        result.loadedFootprint?.drawIds ??
        plan?.footprint.drawIds ??
        (ids.length === 1 && typeof params?.drawId === 'string' ? [params.drawId] : undefined),
      version: recordRevision(record),
    });
  }
}
