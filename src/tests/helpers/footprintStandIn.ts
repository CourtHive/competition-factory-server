import { shadowFootprint } from 'src/modules/factory/helpers/executionQueueShadow';
import { tools } from 'tods-competition-factory';

/**
 * A stand-in for the factory's footprint tools (`tools.getMutationFootprint`, `tools.reduceRecordToFootprint`), for
 * specs that run against a factory that does not have them yet (published 7.30.0). Same contract, narrower: a queue of
 * `setMatchUpStatus` calls that all name their drawId is draw-bounded (shell + those draws, no participants: the
 * factory's answer for a score entry under v2); anything else needs the whole record.
 */
export const nativeFootprintTools = typeof (tools as any).getMutationFootprint === 'function';

const standIn = {
  getMutationFootprint: ({ methods }: any) => {
    const drawIds = methods.map(({ params }: any) => params?.drawId);
    const declared = methods.every(({ method }: any) => method === 'setMatchUpStatus') && drawIds.every(Boolean);
    return declared
      ? { tournament: false, shards: ['shell', 'draw'], drawIds, eventIds: [], wholeRecordMethods: [] }
      : { tournament: true, shards: ['tournament'], drawIds: [], eventIds: [], wholeRecordMethods: ['?'] };
  },
  reduceRecordToFootprint: ({ tournamentRecord, footprint }: any) => {
    const record = structuredClone(tournamentRecord);
    for (const event of record.events ?? []) {
      event.drawDefinitions = (event.drawDefinitions ?? []).filter(({ drawId }: any) =>
        footprint.drawIds.includes(drawId),
      );
    }
    record.participants = [];
    return record;
  },
};

/** Install the stand-in unless the factory has the real tools; returns the undo. */
export function installFootprintStandIn(): () => void {
  if (nativeFootprintTools) return () => undefined;
  const original = shadowFootprint.tools;
  shadowFootprint.tools = () => standIn;
  return () => {
    shadowFootprint.tools = original;
  };
}

/** Remove the footprint tools, for the spec that proves the shadow is inert without them; returns the undo. */
export function removeFootprintTools(): () => void {
  const original = shadowFootprint.tools;
  shadowFootprint.tools = () => undefined;
  return () => {
    shadowFootprint.tools = original;
  };
}
