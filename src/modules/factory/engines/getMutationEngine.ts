import { auditConstants, governors, asyncEngine, globalState, topicConstants } from 'tods-competition-factory';
import asyncGlobalState from './asyncGlobalState';
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

import type { DeltaBuffer } from '../projection/projectionTypes';

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
// asyncGlobalState.runWithInstanceState(); getInstanceState() is fail-closed, so an entry
// point that forgets throws loudly instead of silently sharing. See competition-factory#4564.

export function getMutationEngine(services?, publicNotices?: any[], deltaBuffer?: DeltaBuffer) {
  const engineAsync = asyncEngine();
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
    services?.cacheManager?.del(`gti|${tournamentId}`);
    services?.cacheManager?.del(`gtm|${tournamentId}`);
    services?.cacheManager?.del(`gac|${tournamentId}`);
    services?.cacheManager?.del(`gtp|${tournamentId}`);
    services?.cacheManager?.del(`gmr|${tournamentId}`);
  };
  globalState.setSubscriptions({
    subscriptions: {
      [topicConstants.MODIFY_MATCHUP]: (params) => {
        for (const item of params) {
          clearCache(item.tournamentId);
          recordMatchUpResult(deltaBuffer, item);
          const matchUp = item?.matchUp;
          if (!matchUp || !publicNotices) continue;
          publicNotices.push({
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
        recordPositionAssignments(deltaBuffer, params);
        for (const item of params) {
          // Clear event data cache using the eventId from position assignment notices
          if (item.tournamentId && item.eventId) {
            const eventDataKey = `ged|${item.tournamentId}|${item.eventId}`;
            services?.cacheManager?.del(eventDataKey);
          }
          clearCache(item.tournamentId);
          publicNotices?.push({
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
          recordEvents(deltaBuffer, params); // event.published flag on the events row
          for (const item of params) {
            const eventId = item.eventData?.eventInfo?.eventId;
            if (item.tournamentId && eventId) {
              // Invalidate rather than seed: the controller's cacheFx wraps the
              // factory result as { success, eventData, participants }, but
              // item.eventData here is only the inner eventData object — seeding
              // it directly would serve a participants-less shape to the next
              // public reader for the full TTL, blanking every bracket side to TBD.
              const eventDataKey = `ged|${item.tournamentId}|${eventId}`;
              services?.cacheManager?.del(eventDataKey);
            }
            clearCache(item.tournamentId);
            recordRepublishEvent(deltaBuffer, item.tournamentId, eventId);
            publicNotices?.push({
              topic: topicConstants.PUBLISH_EVENT,
              tournamentId: item.tournamentId,
              eventId,
            });
          }
        }
      },
      [topicConstants.UNPUBLISH_EVENT]: (params) => {
        recordEvents(deltaBuffer, params); // event.published flag on the events row
        for (const item of params) {
          if (item.tournamentId && item.eventId) {
            const eventDataKey = `ged|${item.tournamentId}|${item.eventId}`;
            services?.cacheManager?.del(eventDataKey);
          }
          clearCache(item.tournamentId);
          recordRepublishEvent(deltaBuffer, item.tournamentId, item.eventId);
          publicNotices?.push({
            topic: topicConstants.UNPUBLISH_EVENT,
            tournamentId: item.tournamentId,
            eventId: item.eventId,
          });
        }
      },
      [topicConstants.UNPUBLISH_ORDER_OF_PLAY]: (params) => {
        recordOrderOfPlay(deltaBuffer, params); // order-of-play publication state
        for (const item of params) {
          if (item?.tournamentId) {
            const key = `gtm|${item.tournamentId}`;
            services?.cacheManager?.del(key);
          }
          clearCache(item.tournamentId);
          recordTouchTournament(deltaBuffer, item.tournamentId); // refresh tournaments.published
          publicNotices?.push({
            topic: topicConstants.UNPUBLISH_ORDER_OF_PLAY,
            tournamentId: item.tournamentId,
          });
        }
      },
      [topicConstants.PUBLISH_ORDER_OF_PLAY]: (params) => {
        recordOrderOfPlay(deltaBuffer, params); // order-of-play publication state
        for (const item of params) {
          clearCache(item.tournamentId);
          recordTouchTournament(deltaBuffer, item.tournamentId); // refresh tournaments.published
          publicNotices?.push({
            topic: topicConstants.PUBLISH_ORDER_OF_PLAY,
            tournamentId: item.tournamentId,
          });
        }
      },
      [topicConstants.PUBLISH_PARTICIPANTS]: (params) => {
        recordParticipantPublish(deltaBuffer, params); // participant-list publish state
        for (const item of params) {
          clearCache(item.tournamentId);
          recordTouchTournament(deltaBuffer, item.tournamentId); // refresh tournaments.published
          publicNotices?.push({
            topic: topicConstants.PUBLISH_PARTICIPANTS,
            tournamentId: item.tournamentId,
          });
        }
      },
      [topicConstants.UNPUBLISH_PARTICIPANTS]: (params) => {
        recordParticipantPublish(deltaBuffer, params);
        for (const item of params) {
          clearCache(item.tournamentId);
          recordTouchTournament(deltaBuffer, item.tournamentId);
          publicNotices?.push({
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
          recordTouchTournament(deltaBuffer, item.tournamentId);
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
        recordDeleteEventsFromAudit(deltaBuffer, params, auditConstants.DELETE_EVENTS);
        const auditService = services?.auditService;
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
                  userId: services?.userId,
                  userEmail: services?.userEmail,
                  source: services?.auditSource,
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
          recordTouchTournament(deltaBuffer, tournamentId);
          const { parentOrganisation, ...updates } = tournamentUpdate as any;
          const providerId = parentOrganisation?.organisationId;
          if (providerId) {
            services?.tournamentStorageService?.modifyProviderCalendar({ providerId, tournamentId, updates });
          }
        }
      },
      // ── Read-model projection producers (flag-gated via deltaBuffer) ─────────
      // Each recorder is a no-op when deltaBuffer is undefined (feature off), so
      // subscribing here is inert on the mutation path until switched on. These
      // topics had no prior CFS subscription; the factory only retains a notice
      // when a subscription exists, so they must be registered to be observed.
      [topicConstants.ADD_MATCHUPS]: (params) => recordAddMatchUps(deltaBuffer, params),
      [topicConstants.ADD_DRAW_DEFINITION]: (params) => {
        recordAddDraw(deltaBuffer, params); // flatten matchUps
        recordDraw(deltaBuffer, params); // draw + structures rows
      },
      [topicConstants.MODIFY_DRAW_DEFINITION]: (params) => recordDraw(deltaBuffer, params),
      [topicConstants.ADD_PARTICIPANTS]: (params) => {
        recordParticipants(deltaBuffer, params);
        recordPersonClaims(deltaBuffer, params, CANONICAL_PERSON);
      },
      [topicConstants.MODIFY_PARTICIPANTS]: (params) => {
        recordParticipants(deltaBuffer, params);
        recordPersonClaims(deltaBuffer, params, CANONICAL_PERSON);
      },
      [topicConstants.ADD_EVENT]: (params) => recordEvents(deltaBuffer, params),
      [topicConstants.MODIFY_EVENT]: (params) => recordEvents(deltaBuffer, params),
      [topicConstants.DELETE_EVENT]: (params) => recordDeleteEvent(deltaBuffer, params),
      // publishing/un-publishing event seeding flips the event's publish status
      // (getEventPublishStatus, which drives events.published in cast) — re-cast the
      // events rows so query_events.published does not go stale on a seeding publish.
      [topicConstants.PUBLISH_EVENT_SEEDING]: (params) => recordEvents(deltaBuffer, params),
      [topicConstants.UNPUBLISH_EVENT_SEEDING]: (params) => recordEvents(deltaBuffer, params),
      [topicConstants.MODIFY_EVENT_ENTRIES]: (params) => recordEntries(deltaBuffer, params),
      [topicConstants.MODIFY_DRAW_ENTRIES]: (params) => recordEntries(deltaBuffer, params),
      [topicConstants.MODIFY_SEED_ASSIGNMENTS]: (params) => recordSeeds(deltaBuffer, params),
      [topicConstants.MODIFY_SCHEDULING_PROFILE]: (params) => recordSchedulingProfile(deltaBuffer, params),
      [topicConstants.ADD_VENUE]: (params) => recordVenue(deltaBuffer, params),
      [topicConstants.MODIFY_VENUE]: (params) => recordVenue(deltaBuffer, params),
      [topicConstants.DELETE_VENUE]: (params) => recordDeleteVenue(deltaBuffer, params),
      [topicConstants.DELETED_DRAW_IDS]: (params) => recordDeleteDraw(deltaBuffer, params),
      [topicConstants.DELETED_MATCHUP_IDS]: (params) => recordDeleteMatchUps(deltaBuffer, params),
      [topicConstants.DELETE_PARTICIPANTS]: (params) => recordDeleteParticipants(deltaBuffer, params),
    },
  });

  return engineAsync;
}
