import { governors, asyncEngine, globalState, topicConstants } from 'tods-competition-factory';
import asyncGlobalState from './asyncGlobalState';

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
asyncGlobalState.createInstanceState(); // is there only one instance of asyncGlobalState?

export function getMutationEngine(services?, publicNotices?: any[]) {
  const engineAsync = asyncEngine();
  const clearCache = (tournamentId) => {
    if (!tournamentId || typeof tournamentId !== 'string') return;
    // remove cached tournammentInfo so that event will be immediately available
    const infoKey = `gti|${tournamentId}`;
    services?.cacheManager?.del(infoKey);
    // remove cached scheduling
    const scheduleKey = `gtm|${tournamentId}`;
    services?.cacheManager?.del(scheduleKey);
  };
  globalState.setSubscriptions({
    subscriptions: {
      [topicConstants.MODIFY_MATCHUP]: (params) => {
        for (const item of params) {
          clearCache(item.tournamentId);
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
          for (const item of params) {
            if (item.tournamentId && item.eventData?.eventInfo?.eventId) {
              const key = `ged|${item.tournamentId}|${item.eventData.eventInfo.eventId}`;
              services?.cacheManager?.set(key, item.eventData, 60 * 3 * 1000); // 3 minutes
            }
            clearCache(item.tournamentId);
            publicNotices?.push({
              topic: topicConstants.PUBLISH_EVENT,
              tournamentId: item.tournamentId,
              eventId: item.eventData?.eventInfo?.eventId,
            });
          }
        }
      },
      [topicConstants.UNPUBLISH_EVENT]: (params) => {
        for (const item of params) {
          if (item.tournamentId && item.eventId) {
            const eventDataKey = `ged|${item.tournamentId}|${item.eventId}`;
            services?.cacheManager?.del(eventDataKey);
          }
          clearCache(item.tournamentId);
          publicNotices?.push({
            topic: topicConstants.UNPUBLISH_EVENT,
            tournamentId: item.tournamentId,
            eventId: item.eventId,
          });
        }
      },
      [topicConstants.UNPUBLISH_ORDER_OF_PLAY]: (params) => {
        for (const item of params) {
          if (item?.tournamentId) {
            const key = `gtm|${item.tournamentId}`;
            services?.cacheManager?.del(key);
          }
          clearCache(item.tournamentId);
          publicNotices?.push({
            topic: topicConstants.UNPUBLISH_ORDER_OF_PLAY,
            tournamentId: item.tournamentId,
          });
        }
      },
      [topicConstants.PUBLISH_ORDER_OF_PLAY]: (params) => {
        for (const item of params) {
          clearCache(item.tournamentId);
          publicNotices?.push({
            topic: topicConstants.PUBLISH_ORDER_OF_PLAY,
            tournamentId: item.tournamentId,
          });
        }
      },
      [topicConstants.PUBLISH_PARTICIPANTS]: (params) => {
        for (const item of params) {
          clearCache(item.tournamentId);
          publicNotices?.push({
            topic: topicConstants.PUBLISH_PARTICIPANTS,
            tournamentId: item.tournamentId,
          });
        }
      },
      [topicConstants.UNPUBLISH_PARTICIPANTS]: (params) => {
        for (const item of params) {
          clearCache(item.tournamentId);
          publicNotices?.push({
            topic: topicConstants.UNPUBLISH_PARTICIPANTS,
            tournamentId: item.tournamentId,
          });
        }
      },
      [topicConstants.UNPUBLISH_TOURNAMENT]: (params) => {
        for (const item of params) {
          clearCache(item.tournamentId);
        }
      },
      [topicConstants.MODIFY_TOURNAMENT_DETAIL]: (params) => {
        const tournamentUpdates = params.reduce((tu, item) => {
          const { tournamentId, ...updates } = item;
          tu[tournamentId] = { ...tu[tournamentId], ...updates };
          return tu;
        }, {});

        for (const [tournamentId, tournamentUpdate] of Object.entries(tournamentUpdates)) {
          const { parentOrganisation, ...updates } = tournamentUpdate as any;
          const providerId = parentOrganisation?.organisationId;
          if (providerId) {
            services?.tournamentStorageService?.modifyProviderCalendar({ providerId, tournamentId, updates });
          }
        }
      },
    },
  });

  return engineAsync;
}
