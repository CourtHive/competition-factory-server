/**
 * Resolve the scope-relevant attributes of what a mutation targets.
 *
 * ## Lazy by construction
 *
 * Most dimensions come free from the mutation params. `courtIds` and
 * `scheduledDates` do not — they require finding the matchUp inside the
 * tournament record. That lookup is only performed when a grant actually
 * constrains those dimensions, so an unscoped or id-scoped grant never pays for
 * it. `requiredTargetKeys` drives that decision.
 *
 * This matters: the gate runs on every mutation on the one server that must not
 * stall, and a per-mutation full scan of a large tournament would be exactly the
 * kind of cost architectural standard A7 exists to prevent.
 */
import type { MutationTarget, ScopeKey } from './grantScope';

type Method = { method?: string; params?: any };

/** Params that name a matchUp directly. */
function matchUpIdOf(params: any): string | undefined {
  return params?.matchUpId ?? params?.matchUpIds?.[0];
}

/**
 * Attributes derivable from the params alone — no record traversal.
 * Covers the id dimensions, which is what most grants will use.
 */
export function targetFromParams(method: Method): MutationTarget {
  const params = method?.params ?? {};
  return {
    matchUpIds: matchUpIdOf(params),
    drawIds: params.drawId,
    eventIds: params.eventId,
    structureIds: params.structureId,
    venueIds: params.venueId,
    courtIds: params.courtId,
    scheduledDates: params.scheduledDate ?? params.date,
  };
}

/**
 * Fill in dimensions the params could not answer by locating the matchUp in the
 * tournament record. Only called for dimensions a grant actually constrains.
 *
 * Deliberately a targeted walk rather than `allTournamentMatchUps`: we know the
 * matchUpId, so there is no reason to materialize every matchUp in the
 * tournament to find one.
 */
export function enrichTargetFromRecord(
  target: MutationTarget,
  tournament: any,
  needed: ScopeKey[],
): MutationTarget {
  const wantsSchedule = needed.includes('courtIds') || needed.includes('scheduledDates');
  const wantsStructure = needed.includes('structureIds') || needed.includes('eventIds');
  if (!wantsSchedule && !wantsStructure) return target;

  const matchUpId = target.matchUpIds;
  if (!matchUpId) return target;

  for (const event of tournament?.events ?? []) {
    for (const drawDefinition of event?.drawDefinitions ?? []) {
      for (const structure of drawDefinition?.structures ?? []) {
        const found = findInStructure(structure, matchUpId);
        if (!found) continue;
        return {
          ...target,
          eventIds: target.eventIds ?? event.eventId,
          drawIds: target.drawIds ?? drawDefinition.drawId,
          structureIds: target.structureIds ?? found.structureId,
          courtIds: target.courtIds ?? found.matchUp?.schedule?.courtId,
          scheduledDates: target.scheduledDates ?? found.matchUp?.schedule?.scheduledDate,
        };
      }
    }
  }
  return target;
}

/** Depth-first through a structure and any child structures (round robins). */
function findInStructure(structure: any, matchUpId: string): { matchUp: any; structureId: string } | undefined {
  for (const matchUp of structure?.matchUps ?? []) {
    if (matchUp?.matchUpId === matchUpId) return { matchUp, structureId: structure.structureId };
  }
  for (const child of structure?.structures ?? []) {
    const found = findInStructure(child, matchUpId);
    if (found) return found;
  }
  return undefined;
}
