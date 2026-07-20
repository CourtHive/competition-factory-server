import { MUTATION_PERMISSIONS } from '@courthive/provider-config';

/**
 * Pure classification + extraction helpers for the facility-schedule-changed fan-out.
 *
 * A peer director rescheduling is NOT delivered to a coordinating client (the peer tournament isn't
 * loaded, so the client never joins the peer's room). This fan-out emits an opaque
 * `facilityScheduleChanged` to the linked peers' rooms so they re-fetch their reserved-cell
 * projection. These helpers decide WHICH mutations trigger it and WHERE it goes — kept pure so the
 * decision is unit-testable without the socket server or storage.
 */

const CAN_MODIFY_SCHEDULE = 'canModifySchedule';

/**
 * Link-graph mutations aren't in `MUTATION_PERMISSIONS` (they gate on tournament access, not a
 * schedule permission) but they change WHICH peers coordinate around a tournament — a peer that
 * appears or vanishes must refresh its reserved cells. So they count as schedule-affecting for
 * fan-out. This is the one explicit list the design sanctions; every other schedule method is read
 * from the shared `MUTATION_PERMISSIONS` map (no second hand-maintained list).
 */
export const SCHEDULE_LINK_GRAPH_METHODS = new Set(['linkTournaments', 'unlinkTournaments', 'unlinkTournament']);

/**
 * True when at least one method moves courts (maps to `canModifySchedule`) or changes the link graph.
 * Score/status/draw mutations do not move courts and must not fan out.
 */
export function isScheduleAffecting(methodNames: string[]): boolean {
  return methodNames.some(
    (name) => MUTATION_PERMISSIONS[name] === CAN_MODIFY_SCHEDULE || SCHEDULE_LINK_GRAPH_METHODS.has(name),
  );
}

/** True when at least one method links/unlinks tournaments (drives the vanished-peer fan-out). */
export function isLinkGraphMutation(methodNames: string[]): boolean {
  return methodNames.some((name) => SCHEDULE_LINK_GRAPH_METHODS.has(name));
}

/**
 * Union of venue ids referenced by the mutation params (single `venueId`, a nested `schedule.venueId`,
 * or a `venueIds` array). Lets receivers skip events that don't touch their venues. Best-effort — the
 * flush falls back to the source tournament's own venues when nothing is derivable here, and the
 * client re-gates by intersecting with its own venues regardless.
 */
export function venueIdsFromMethods(methods: any[]): string[] {
  const ids = new Set<string>();
  for (const method of methods ?? []) {
    const params = method?.params ?? {};
    const candidates = [params.venueId, params.schedule?.venueId, ...(Array.isArray(params.venueIds) ? params.venueIds : [])];
    for (const candidate of candidates) if (candidate) ids.add(candidate);
  }
  return [...ids];
}

/** Venue ids owned by a tournament record — the fallback fan-out scope when params carry none. */
export function venueIdsFromRecord(record: any): string[] {
  return (record?.venues ?? []).map((venue: any) => venue?.venueId).filter(Boolean);
}

/**
 * The rooms a source tournament's schedule change fans out to: its server-stored linked peers, plus —
 * for a link-graph mutation — the other tournaments named in the mutation batch. The latter covers
 * UNLINK: after an unlink both records drop the link, so the vanished peer is no longer in
 * `linkedTournamentIds` and must be reached via the batch's `tournamentIds` so it clears its cell.
 * The source itself is always excluded.
 */
export function computeFanOutTargets(
  record: any,
  pending: { linkGraph: boolean; groupIds: Set<string> },
  sourceId: string,
): string[] {
  const targets = new Set<string>();
  for (const id of record?.linkedTournamentIds ?? []) if (id && id !== sourceId) targets.add(id);
  if (pending.linkGraph) for (const id of pending.groupIds) if (id && id !== sourceId) targets.add(id);
  return [...targets];
}
