import { auditConstants, governors, asyncEngine, globalState, topicConstants } from 'tods-competition-factory';
import asyncGlobalState from './asyncGlobalState';
import { getRequestContext } from './requestContext';
import {
  recordAddDraw,
  recordAddMatchUps,
  recordDeleteDraw,
  recordDeleteEvent,
  recordDeleteMatchUps,
  recordDeleteParticipants,
  recordDeleteEventsFromAudit,
  recordDeleteVenue,
  recordDraw,
  recordEntries,
  recordEvents,
  recordOrderOfPlay,
  recordParticipantPublish,
  recordSchedulingProfile,
  recordMatchUpResult,
  recordParticipants,
  recordPersonClaims,
  recordPositionAssignments,
  recordRepublishEvent,
  recordSeeds,
  recordTouchTournament,
  recordVenue,
} from '../projection/deltaBuffer';
import { CANONICAL_PERSON } from 'src/common/constants/canonicalPerson';

const traverse = true;
const global = true;
const depth = 1;

globalState.setStateMethods(governors, traverse, depth, global); // globally imports methods from governors
globalState.setStateProvider(asyncGlobalState);
globalState.setGlobalSubscriptions({
  subscriptions: {
    // any subscriptions that don't need access to cacheManager can go here
  },
});
// CODES Phase 6: the server is the canonical audit trail for drawDeletions.
// The factory suppresses all local drawDeletions writes when this is true,
// dispatches only the AUDIT topic notice. The AuditService subscription below
// captures the snapshot.
globalState.setAuditAuthorityServer(true);
// DECISION: no module-scope createInstanceState().
// WHY: seeding once at import gave every request in the process the SAME instance state —
// per-request isolation in name only. Each entry point now establishes its own context via
// asyncGlobalState.runWithInstanceState(). getInstanceState() lazily creates a context-scoped
// state and warns when an entry point forgets — it never shares one process-wide state.
// See competition-factory#4564.

// DECISION: the subscription handlers are registered ONCE, at module scope, and read their
// per-request values from the request context instead of from closures.
// WHY: every handler below is deploy-scoped in shape — identical on every request, nothing
// tournament-, provider- or user-dependent. They were re-registered on every mutation solely to
// rebind publicNotices / deltaBuffer / cacheManager via closure. Factory keeps ONE subscription
// slot per topic, so a second concurrent request overwrote the first's handlers and delivered its
// notices into the wrong arrays. Registering once removes that failure mode by construction —
// there is nothing left to overwrite — and takes per-request registration off the mutation hot
// path. See competition-factory#4564.
const requestPublicNotices = () => getRequestContext().publicNotices;
const requestDeltaBuffer = () => getRequestContext().deltaBuffer;
const requestServices = () => getRequestContext().services;

/**
 * Delete the per-event `ged|<tid>|<eid>` key and record that a targeted eviction happened.
 *
 * The controller's `invalidateTournamentCache` consults `requestEvictedEventKeys()` and skips its
 * blanket `ged|` sweep only when at least one targeted eviction was recorded. That is the fail-safe:
 * a mutation whose notices never carry an eventId evicts nothing here, the set stays empty, and the
 * controller falls back to the old tournament-wide behaviour rather than serving stale event data.
 */
const evictEventData = (tournamentId, eventId) => {
  if (!tournamentId || !eventId) return;
  const key = `ged|${tournamentId}|${eventId}`;
  requestServices()?.cacheManager?.del(key);
  getRequestContext().evictedEventKeys?.add(key);
};

const clearCache = (tournamentId) => {
  if (!tournamentId || typeof tournamentId !== 'string') return;
  // Evict every fixed-shape per-tournament cache key on every
  // mutation-triggered notice. Covers both the WebSocket path
  // (tmxMessages → executionQueue → getMutationEngine subscriptions
  // → here) AND the HTTP path (controller's invalidateTournamentCache
  // catches the same shapes via its side-table). Flag-variant
  // gti|<tid>|<flags> keys are NOT evicted here — they're only
  // tracked in the HTTP controller's side-table. WS-driven mutations
  // therefore leave flag-variant tournamentInfo reads stale until
  // the 3-minute cache-manager TTL elapses (acceptable: the live
  // broadcast already notifies interactive clients, and polling
  // consumers that need consistency should re-read via the
  // no-flags route).
  requestServices()?.cacheManager?.del(`gti|${tournamentId}`);
  requestServices()?.cacheManager?.del(`gtm|${tournamentId}`);
  requestServices()?.cacheManager?.del(`gac|${tournamentId}`);
  requestServices()?.cacheManager?.del(`gtp|${tournamentId}`);
  requestServices()?.cacheManager?.del(`gmr|${tournamentId}`);
};
/**
 * Topic → handler map. Exported so the wiring can be asserted directly: registration happens once
 * at module load, so a spec cannot capture it by spying on a per-request call. Handlers read their
 * per-request values from the request context — drive them inside
 * `runWithRequestContext({ deltaBuffer, publicNotices })`.
 */
export const subscriptionHandlers = {
  [topicConstants.MODIFY_MATCHUP]: (params) => {
    for (const item of params) {
      clearCache(item.tournamentId);
      recordMatchUpResult(requestDeltaBuffer(), item);
      const matchUp = item?.matchUp;
      const notices = requestPublicNotices();
      if (!matchUp || !notices) continue;
      notices.push({
        topic: topicConstants.MODIFY_MATCHUP,
        tournamentId: item.tournamentId,
        matchUp: {
          matchUpStatus: matchUp.matchUpStatus,
          drawPositions: matchUp.drawPositions,
          winningSide: matchUp.winningSide,
          matchUpId: matchUp.matchUpId,
          score: matchUp.score,
        },
      });
    }
  },
  [topicConstants.MODIFY_POSITION_ASSIGNMENTS]: (params) => {
    recordPositionAssignments(requestDeltaBuffer(), params);
    for (const item of params) {
      // Clear event data cache using the eventId from position assignment notices
      evictEventData(item.tournamentId, item.eventId);
      clearCache(item.tournamentId);
      requestPublicNotices()?.push({
        topic: topicConstants.MODIFY_POSITION_ASSIGNMENTS,
        positionAssignments: item.positionAssignments,
        tournamentId: item.tournamentId,
        structureId: item.structureId,
        eventId: item.eventId,
        drawId: item.drawId,
      });
    }
  },
  [topicConstants.PUBLISH_EVENT]: (params) => {
    if (Array.isArray(params)) {
      recordEvents(requestDeltaBuffer(), params); // event.published flag on the events row
      for (const item of params) {
        const eventId = item.eventData?.eventInfo?.eventId;
        if (item.tournamentId && eventId) {
          // Invalidate rather than seed: the controller's cacheFx wraps the
          // factory result as { success, eventData, participants }, but
          // item.eventData here is only the inner eventData object — seeding
          // it directly would serve a participants-less shape to the next
          // public reader for the full TTL, blanking every bracket side to TBD.
          evictEventData(item.tournamentId, eventId);
        }
        clearCache(item.tournamentId);
        recordRepublishEvent(requestDeltaBuffer(), item.tournamentId, eventId);
        requestPublicNotices()?.push({
          topic: topicConstants.PUBLISH_EVENT,
          tournamentId: item.tournamentId,
          eventId,
        });
      }
    }
  },
  [topicConstants.UNPUBLISH_EVENT]: (params) => {
    recordEvents(requestDeltaBuffer(), params); // event.published flag on the events row
    for (const item of params) {
      evictEventData(item.tournamentId, item.eventId);
      clearCache(item.tournamentId);
      recordRepublishEvent(requestDeltaBuffer(), item.tournamentId, item.eventId);
      requestPublicNotices()?.push({
        topic: topicConstants.UNPUBLISH_EVENT,
        tournamentId: item.tournamentId,
        eventId: item.eventId,
      });
    }
  },
  [topicConstants.UNPUBLISH_ORDER_OF_PLAY]: (params) => {
    recordOrderOfPlay(requestDeltaBuffer(), params); // order-of-play publication state
    for (const item of params) {
      if (item?.tournamentId) {
        const key = `gtm|${item.tournamentId}`;
        requestServices()?.cacheManager?.del(key);
      }
      clearCache(item.tournamentId);
      recordTouchTournament(requestDeltaBuffer(), item.tournamentId); // refresh tournaments.published
      requestPublicNotices()?.push({
        topic: topicConstants.UNPUBLISH_ORDER_OF_PLAY,
        tournamentId: item.tournamentId,
      });
    }
  },
  [topicConstants.PUBLISH_ORDER_OF_PLAY]: (params) => {
    recordOrderOfPlay(requestDeltaBuffer(), params); // order-of-play publication state
    for (const item of params) {
      clearCache(item.tournamentId);
      recordTouchTournament(requestDeltaBuffer(), item.tournamentId); // refresh tournaments.published
      requestPublicNotices()?.push({
        topic: topicConstants.PUBLISH_ORDER_OF_PLAY,
        tournamentId: item.tournamentId,
      });
    }
  },
  [topicConstants.PUBLISH_PARTICIPANTS]: (params) => {
    recordParticipantPublish(requestDeltaBuffer(), params); // participant-list publish state
    for (const item of params) {
      clearCache(item.tournamentId);
      recordTouchTournament(requestDeltaBuffer(), item.tournamentId); // refresh tournaments.published
      requestPublicNotices()?.push({
        topic: topicConstants.PUBLISH_PARTICIPANTS,
        tournamentId: item.tournamentId,
      });
    }
  },
  [topicConstants.UNPUBLISH_PARTICIPANTS]: (params) => {
    recordParticipantPublish(requestDeltaBuffer(), params);
    for (const item of params) {
      clearCache(item.tournamentId);
      recordTouchTournament(requestDeltaBuffer(), item.tournamentId);
      requestPublicNotices()?.push({
        topic: topicConstants.UNPUBLISH_PARTICIPANTS,
        tournamentId: item.tournamentId,
      });
    }
  },
  // the tournament went dark (neither order-of-play nor participants published)
  // → refresh the aggregate tournaments.published flag.
  [topicConstants.UNPUBLISH_TOURNAMENT]: (params) => {
    for (const item of params) {
      clearCache(item.tournamentId);
      recordTouchTournament(requestDeltaBuffer(), item.tournamentId);
    }
  },
  [topicConstants.AUDIT]: (params) => {
    // Each params entry: { tournamentId, detail: auditTrail }
    // auditTrail is an array of audit entries; deleteDrawDefinitions emits
    // one entry per deleted draw with action=DELETE_DRAW_DEFINITIONS and
    // payload.drawDefinitions being a single-element array of the snapshot.
    // Event deletion fires ONLY an AUDIT notice (no dedicated topic) —
    // record the read-model delete before the auditService guard so it
    // runs even when audit is unavailable.
    recordDeleteEventsFromAudit(requestDeltaBuffer(), params, auditConstants.DELETE_EVENTS);
    const auditService = requestServices()?.auditService;
    if (!auditService) return;
    for (const item of params) {
      const { tournamentId, detail } = item ?? {};
      if (!tournamentId || !Array.isArray(detail)) continue;
      for (const entry of detail) {
        if (entry?.action !== auditConstants.DELETE_DRAW_DEFINITIONS) continue;
        const drawDefinitions = entry?.payload?.drawDefinitions ?? [];
        const eventId = entry?.payload?.eventId;
        const auditData = entry?.payload?.auditData;
        for (const drawDefinition of drawDefinitions) {
          auditService
            .recordDrawDeletion({
              tournamentId,
              eventId,
              drawId: drawDefinition?.drawId,
              drawName: drawDefinition?.drawName,
              drawType: drawDefinition?.drawType,
              deletedDrawSnapshot: drawDefinition,
              auditData,
              userId: requestServices()?.userId,
              userEmail: requestServices()?.userEmail,
              source: requestServices()?.auditSource,
            })
            .catch(() => {
              /* fail-soft — AuditService logs internally */
            });
        }
      }
    }
  },
  [topicConstants.MODIFY_TOURNAMENT_DETAIL]: (params) => {
    const tournamentUpdates = params.reduce((tu, item) => {
      const { tournamentId, ...updates } = item;
      tu[tournamentId] = { ...tu[tournamentId], ...updates };
      return tu;
    }, {});

    for (const [tournamentId, tournamentUpdate] of Object.entries(tournamentUpdates)) {
      recordTouchTournament(requestDeltaBuffer(), tournamentId);
      const { parentOrganisation, ...updates } = tournamentUpdate as any;
      const providerId = parentOrganisation?.organisationId;
      if (providerId) {
        requestServices()?.tournamentStorageService?.modifyProviderCalendar({ providerId, tournamentId, updates });
      }
    }
  },
  // ── Read-model projection producers (flag-gated via requestDeltaBuffer()) ─────────
  // Each recorder is a no-op when requestDeltaBuffer() is undefined (feature off), so
  // subscribing here is inert on the mutation path until switched on. These
  // topics had no prior CFS subscription; the factory only retains a notice
  // when a subscription exists, so they must be registered to be observed.
  [topicConstants.ADD_MATCHUPS]: (params) => recordAddMatchUps(requestDeltaBuffer(), params),
  [topicConstants.ADD_DRAW_DEFINITION]: (params) => {
    recordAddDraw(requestDeltaBuffer(), params); // flatten matchUps
    recordDraw(requestDeltaBuffer(), params); // draw + structures rows
  },
  [topicConstants.MODIFY_DRAW_DEFINITION]: (params) => {
    recordDraw(requestDeltaBuffer(), params);
    // `modifyDrawNotice` carries eventId, and `modifyMatchUpNotice` fires it alongside every
    // MODIFY_MATCHUP that has a drawDefinition — so this is where a SCORE gets its per-event
    // eviction. MODIFY_MATCHUP's own payload is only { matchUp, tournamentId, context } and cannot
    // target. Evicting here keeps the score path precise without a factory change.
    for (const item of params ?? []) evictEventData(item?.tournamentId, item?.eventId);
  },
  [topicConstants.ADD_PARTICIPANTS]: (params) => {
    recordParticipants(requestDeltaBuffer(), params);
    recordPersonClaims(requestDeltaBuffer(), params, CANONICAL_PERSON);
  },
  [topicConstants.MODIFY_PARTICIPANTS]: (params) => {
    recordParticipants(requestDeltaBuffer(), params);
    recordPersonClaims(requestDeltaBuffer(), params, CANONICAL_PERSON);
  },
  [topicConstants.ADD_EVENT]: (params) => recordEvents(requestDeltaBuffer(), params),
  [topicConstants.MODIFY_EVENT]: (params) => recordEvents(requestDeltaBuffer(), params),
  [topicConstants.DELETE_EVENT]: (params) => recordDeleteEvent(requestDeltaBuffer(), params),
  // publishing/un-publishing event seeding flips the event's publish status
  // (getEventPublishStatus, which drives events.published in cast) — re-cast the
  // events rows so query_events.published does not go stale on a seeding publish.
  [topicConstants.PUBLISH_EVENT_SEEDING]: (params) => recordEvents(requestDeltaBuffer(), params),
  [topicConstants.UNPUBLISH_EVENT_SEEDING]: (params) => recordEvents(requestDeltaBuffer(), params),
  [topicConstants.MODIFY_EVENT_ENTRIES]: (params) => recordEntries(requestDeltaBuffer(), params),
  [topicConstants.MODIFY_DRAW_ENTRIES]: (params) => recordEntries(requestDeltaBuffer(), params),
  [topicConstants.MODIFY_SEED_ASSIGNMENTS]: (params) => recordSeeds(requestDeltaBuffer(), params),
  [topicConstants.MODIFY_SCHEDULING_PROFILE]: (params) => recordSchedulingProfile(requestDeltaBuffer(), params),
  [topicConstants.ADD_VENUE]: (params) => recordVenue(requestDeltaBuffer(), params),
  [topicConstants.MODIFY_VENUE]: (params) => recordVenue(requestDeltaBuffer(), params),
  [topicConstants.DELETE_VENUE]: (params) => recordDeleteVenue(requestDeltaBuffer(), params),
  [topicConstants.DELETED_DRAW_IDS]: (params) => recordDeleteDraw(requestDeltaBuffer(), params),
  [topicConstants.DELETED_MATCHUP_IDS]: (params) => recordDeleteMatchUps(requestDeltaBuffer(), params),
  [topicConstants.DELETE_PARTICIPANTS]: (params) => recordDeleteParticipants(requestDeltaBuffer(), params),
};

// DECISION: registration stays PER REQUEST, but the handler map is a module-scope constant.
// WHY: factory's addNotice drops a notice unless an INSTANCE subscription exists for the topic
// (`!instanceState.subscriptions[topic] && !isGlobalSubscription`), so registering only via
// setGlobalSubscriptions silently collects nothing — caught by the audit and broadcast e2e specs.
// Re-registration is now harmless: every request writes the SAME function references, so a
// concurrent request overwriting another's subscriptions is a no-op rather than a hijack. The
// hazard was never the re-registration — it was the handlers closing over per-request data.

/**
 * A mutation engine instance. Subscriptions are registered once at module scope (above), so this
 * no longer takes services / publicNotices / deltaBuffer — the handlers read those from the
 * request context the caller establishes via runWithRequestContext().
 */
export function getMutationEngine() {
  const engineAsync = asyncEngine();
  // DECISION: register AFTER asyncEngine() — engine construction resets the instance state's
  // subscriptions, so registering first silently produced a context with zero subscriptions and
  // addNotice then dropped every notice (no handler fired at all).
  globalState.setSubscriptions({ subscriptions: subscriptionHandlers });
  return engineAsync;
}
