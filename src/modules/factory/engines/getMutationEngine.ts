import { governors, asyncEngine, globalState, topicConstants } from 'tods-competition-factory';
import { modifyProviderCalendar } from 'src/modules/providers/updateCalendar';
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

export function getMutationEngine(services?) {
  const engineAsync = asyncEngine();
  globalState.setSubscriptions({
    subscriptions: {
      [topicConstants.PUBLISH_EVENT]: (params) => {
        if (Array.isArray(params)) {
          for (const item of params) {
            const key = `ged|${item.tournamentId}|${item.eventData.eventInfo.eventId}`;
            services?.cacheManager?.set(key, item.eventData, 60 * 3 * 1000); // 3 minutes
            // remove cached tournammentInfo so that event will be immediately available
            const infoKey = `gti|${item.tournamentId}`;
            services?.cacheManager?.del(infoKey);
          }
        }
      },
      [topicConstants.UNPUBLISH_EVENT]: (params) => {
        for (const item of params) {
          const eventDataKey = `ged|${item.tournamentId}|${item.eventId}`;
          services?.cacheManager?.del(eventDataKey);
          const infoKey = `gti|${item.tournamentId}`;
          services?.cacheManager?.del(infoKey);
        }
      },
      [topicConstants.UNPUBLISH_ORDER_OF_PLAY]: (params) => {
        for (const item of params) {
          const key = `gtm|${item?.tournamentId}`;
          services?.cacheManager?.del(key);
          const infoKey = `gti|${item.tournamentId}`;
          services?.cacheManager?.del(infoKey);
        }
      },
      [topicConstants.PUBLISH_ORDER_OF_PLAY]: (params) => {
        for (const item of params) {
          const infoKey = `gti|${item.tournamentId}`;
          services?.cacheManager?.del(infoKey);
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
          if (providerId) modifyProviderCalendar({ providerId, tournamentId, updates });
        }
      },
    },
  });

  return engineAsync;
}
