import { governors, asyncEngine, globalState, topicConstants } from 'tods-competition-factory';
import asyncGlobalState from './asyncGlobalState';
import { Logger } from '@nestjs/common';

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
            Logger.debug(`publish event: ${key}`);
            services?.cacheManager?.set(key, item, 60 * 3 * 1000); // 3 minutes
            // remove cached tournammentInfo so that event will be immediately available
            const infoKey = `gti|${item.tournamentId}`;
            services?.cacheManager?.del(infoKey);
          }
        }
      },
      [topicConstants.UNPUBLISH_EVENT]: (params) => {
        for (const item of params) {
          const eventDataKey = `ged|${item.tournamentId}|${item.eventId}`;
          Logger.debug(`unpublish event: ${eventDataKey}}`);
          services?.cacheManager?.del(eventDataKey);
          const infoKey = `gti|${item.tournamentId}`;
          services?.cacheManager?.del(infoKey);
        }
      },
    },
  });

  return engineAsync;
}
