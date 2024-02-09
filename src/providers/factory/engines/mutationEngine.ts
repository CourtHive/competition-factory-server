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

export function getMutationEngine(cacheManager?) {
  const engineAsync = asyncEngine();
  globalState.setSubscriptions({
    subscriptions: {
      [topicConstants.PUBLISH_EVENT]: (params) => {
        if (Array.isArray(params)) {
          for (const item of params) {
            const key = `ged|${item.tournamentId}|${item.eventData.eventInfo.eventId}`;
            cacheManager?.set(key, item, 60 * 3 * 1000); // 3 minutes
          }
        }
      },
    },
  });

  return engineAsync;
}
