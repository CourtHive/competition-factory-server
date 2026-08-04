import { DeltaBuffer, ProjectionIntent } from './projectionTypes';

/**
 * Request-scoped delta buffer. Created in executionQueue ONLY when the
 * projection-outbox feature is enabled; when absent every recorder below is a
 * no-op (guarded on a falsy `buffer`), so the mutation path is untouched.
 *
 * `tournamentIds` is the mutation's tournament scope, used to attribute notices
 * whose payload omits `tournamentId` (some draw/participant notices only carry
 * it when the caller passed it).
 */
export function createDeltaBuffer(tournamentIds: string[]): DeltaBuffer {
  return { intents: [], tournamentIds };
}

// Resolve the tournamentId for a notice item: prefer the payload's own id,
// else fall back to the mutation's sole tournament (the common single-record
// case). Returns undefined when the scope is ambiguous — the caller skips.
function tidOf(buffer: DeltaBuffer, itemTournamentId: string | undefined): string | undefined {
  if (itemTournamentId) return itemTournamentId;
  return buffer.tournamentIds.length === 1 ? buffer.tournamentIds[0] : undefined;
}

function push(buffer: DeltaBuffer | undefined, intent: ProjectionIntent): void {
  buffer?.intents.push(intent);
}

// ── ADD_MATCHUPS / ADD_DRAW_DEFINITION → bounded draw flatten ────────────────

/** ADD_MATCHUPS: `{ matchUps, tournamentId, eventId }`. Flatten each distinct
 *  draw the new matchUps belong to (the one point matchUp rows are created). */
export function recordAddMatchUps(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (!tournamentId) continue;
    const drawIds = new Set<string>();
    for (const matchUp of item?.matchUps ?? []) {
      if (matchUp?.drawId) drawIds.add(matchUp.drawId);
    }
    for (const drawId of drawIds) push(buffer, { kind: 'flattenDraw', tournamentId, drawId });
    push(buffer, { kind: 'touchTournament', tournamentId });
  }
}

/** ADD_DRAW_DEFINITION: `{ drawDefinition, tournamentId, eventId }`, key drawId. */
export function recordAddDraw(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    const drawId = item?.drawDefinition?.drawId;
    if (!tournamentId || !drawId) continue;
    push(buffer, { kind: 'flattenDraw', tournamentId, drawId });
    push(buffer, { kind: 'touchTournament', tournamentId });
  }
}

/** MODIFY_POSITION_ASSIGNMENTS: `{ positionAssignments, tournamentId, drawId, … }`.
 *  Position changes alter WHO is in each matchUp → re-flatten the draw. */
export function recordPositionAssignments(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (!tournamentId || !item?.drawId) continue;
    push(buffer, { kind: 'flattenDraw', tournamentId, drawId: item.drawId });
  }
}

// ── MODIFY_MATCHUP → slim result row update (no flatten) ─────────────────────

/** MODIFY_MATCHUP: `{ matchUp, tournamentId, context }`. Record the slim
 *  result — status / winning_side / score — straight from the notice. */
export function recordMatchUpResult(buffer: DeltaBuffer | undefined, item: any): void {
  if (!buffer) return;
  const tournamentId = tidOf(buffer, item?.tournamentId);
  const matchUp = item?.matchUp;
  if (!tournamentId || !matchUp?.matchUpId) return;
  push(buffer, { kind: 'matchUpResult', tournamentId, matchUp });
}

// ── tournament detail / participants / publish ──────────────────────────────

export function recordTouchTournament(buffer: DeltaBuffer | undefined, tournamentId: string | undefined): void {
  if (!buffer) return;
  const tid = tidOf(buffer, tournamentId);
  if (tid) push(buffer, { kind: 'touchTournament', tournamentId: tid });
}

/** ADD_PARTICIPANTS / MODIFY_PARTICIPANTS: `{ tournamentId, participants }`.
 *  Entry membership/person may have changed → refresh the entries fact. */
export function recordParticipants(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  const seen = new Set<string>();
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (tournamentId && !seen.has(tournamentId)) {
      seen.add(tournamentId);
      push(buffer, { kind: 'participants', tournamentId });
    }
  }
}

/** MODIFY_EVENT_ENTRIES / MODIFY_DRAW_ENTRIES: `{ tournamentId, eventId, entries }` /
 *  `{ tournamentId, eventId, drawId, drawEntries }`. Entry membership/status/position
 *  changed WITHOUT necessarily touching a participant record — refresh the entries
 *  fact directly. (The factory only began dispatching these topics with the
 *  notice-completeness work; before that, entries only refreshed on ADD/MODIFY_PARTICIPANTS.) */
export function recordEntries(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  const seen = new Set<string>();
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (tournamentId && !seen.has(tournamentId)) {
      seen.add(tournamentId);
      push(buffer, { kind: 'entries', tournamentId });
    }
  }
}

/** Person self-claim: `addPersonOtherId` stamps `CANONICAL_PERSON` on a
 *  participant's `person.personOtherIds[]` and fires MODIFY_PARTICIPANTS. Detect
 *  that stamp and record a claimPerson intent so the read model's `person_id`
 *  (competitor + entry rows for that participantId) is updated to the canonical
 *  id — otherwise the person-scoped query (getMyParticipations) can't see the
 *  self-claimed rows (they carry only a provider personId, or NULL). Idempotent:
 *  fires on every modification of a claimed participant, always the same value. */
export function recordPersonClaims(buffer: DeltaBuffer | undefined, params: any[], canonicalOrg: string): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (!tournamentId) continue;
    for (const participant of item?.participants ?? []) {
      const participantId = participant?.participantId;
      const otherIds = participant?.person?.personOtherIds ?? [];
      const canonical = otherIds.find((o: any) => o?.organisationId === canonicalOrg);
      if (participantId && canonical?.personId) {
        push(buffer, { kind: 'claimPerson', tournamentId, participantId, personId: canonical.personId });
      }
    }
  }
}

/** PUBLISH_EVENT `{ eventData, tournamentId }` / UNPUBLISH_EVENT `{ tournamentId,
 *  eventId }`. Re-flatten the event's draws to recompute the `published` flag. */
export function recordRepublishEvent(
  buffer: DeltaBuffer | undefined,
  tournamentId: string | undefined,
  eventId: string | undefined,
): void {
  if (!buffer) return;
  const tid = tidOf(buffer, tournamentId);
  if (tid && eventId) push(buffer, { kind: 'republishEvent', tournamentId: tid, eventId });
}

// ── venues ──────────────────────────────────────────────────────────────────

/** ADD_VENUE / MODIFY_VENUE: `{ venue, tournamentId }`. */
export function recordVenue(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (tournamentId && item?.venue?.venueId) push(buffer, { kind: 'venue', tournamentId, venue: item.venue });
  }
}

/** DELETE_VENUE: `{ venueId, tournamentId }`. */
export function recordDeleteVenue(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (tournamentId && item?.venueId) push(buffer, { kind: 'deleteVenue', tournamentId, venueId: item.venueId });
  }
}

// ── deletes ─────────────────────────────────────────────────────────────────

/** DELETED_DRAW_IDS: `{ drawId, tournamentId, eventId }` (one per drawId). */
export function recordDeleteDraw(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (tournamentId && item?.drawId) push(buffer, { kind: 'deleteDraw', tournamentId, drawId: item.drawId });
  }
}

/** DELETE_PARTICIPANTS: `{ participantIds, tournamentId }`. */
export function recordDeleteParticipants(buffer: DeltaBuffer | undefined, params: any[]): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    const participantIds = item?.participantIds ?? [];
    if (tournamentId && participantIds.length) push(buffer, { kind: 'deleteParticipants', tournamentId, participantIds });
  }
}

/** Event deletion fires only an AUDIT notice: `{ tournamentId, detail }` where
 *  `detail[].action === DELETE_EVENTS` (auditConstants) and the deleted event's
 *  id is on the entry payload. Extract eventId(s) and record a delete-by-event. */
export function recordDeleteEventsFromAudit(
  buffer: DeltaBuffer | undefined,
  params: any[],
  deleteEventsAction: string,
): void {
  if (!buffer || !Array.isArray(params)) return;
  for (const item of params) {
    const tournamentId = tidOf(buffer, item?.tournamentId);
    if (!tournamentId || !Array.isArray(item?.detail)) continue;
    for (const entry of item.detail) {
      if (entry?.action !== deleteEventsAction && entry?.type !== deleteEventsAction) continue;
      const eventId = entry?.payload?.eventId ?? entry?.payload?.event?.eventId;
      if (eventId) push(buffer, { kind: 'deleteEvent', tournamentId, eventId });
    }
  }
}
