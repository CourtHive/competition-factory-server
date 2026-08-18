import { factoryConstants, globalState } from 'tods-competition-factory';
import { AsyncLocalStorage } from 'node:async_hooks';

type ImplemtationGlobalStateTypes = globalState.ImplemtationGlobalStateTypes;

const INVALID_VALUES = 'Invalid values';
const SUCCESS = { success: true };
const NOT_FOUND = 'Not found';

/**
 * This code enables "global" state for each async execution context.
 * Creates instance state for each async execution context to support multiple concurrent requests.
 * Sample on this page: https://stackabuse.com/using-async-hooks-for-request-context-handling-in-node-js/
 */

const asyncLocalStorage = new AsyncLocalStorage<ImplemtationGlobalStateTypes>();

function newInstanceState(): ImplemtationGlobalStateTypes {
  return {
    disableNotifications: false,
    tournamentId: undefined,
    tournamentRecords: {},
    subscriptions: {},
    modified: false,
    notices: [],
    methods: {},
  };
}

/**
 * Run `fn` with a fresh instance state bound to it and every async context it spawns.
 * PREFERRED entry point — the store is scoped to the callback, so it cannot outlive the
 * request or bleed into a sibling. Wrap each mutation / query / rebuild entry point in this.
 */
function runWithInstanceState<T>(fn: () => T): T {
  return asyncLocalStorage.run(newInstanceState(), fn);
}

/**
 * Bind a fresh instance state to the CURRENT execution context and its descendants.
 * Back-compat shim for callers that seed and then continue inline. Prefer
 * `runWithInstanceState` — `enterWith` has no scope end.
 */
function createInstanceState() {
  asyncLocalStorage.enterWith(newInstanceState());
}

/**
 * DECISION: lazily bind a NEW state to the current async context; never share, never throw.
 * WHY: two designs were rejected.
 *   - Falling back to one shared default is fail-open — it is exactly the defect this replaces
 *     (a single process-wide state) and it is invisible.
 *   - Throwing is fail-closed but assumes every entry point is statically enumerable. It is not:
 *     `governors.mocksGovernor.generateTournamentRecord()` dispatches notices, so a DIRECT
 *     governor call touches instance state without going near an engine. A strict throw traded a
 *     silent correctness bug for a loud production outage on a call graph we cannot fully sweep.
 * Lazy creation binds via `enterWith`, so the new state covers the current context AND its
 * descendants — a `setState` → `await` → `getState` sequence stays coherent — while remaining
 * isolated from every sibling context. Unwrapped callers get correctness, not sharing.
 * The warning below keeps this fail-soft rather than silent (architectural standard A2):
 * prefer `runWithInstanceState` at each entry point so the store is scoped and released.
 * See competition-factory#4564.
 */
let implicitContextCount = 0;

function getInstanceState(): ImplemtationGlobalStateTypes {
  const instanceState = asyncLocalStorage.getStore();
  if (instanceState) return instanceState;

  implicitContextCount += 1;
  if (implicitContextCount === 1 || implicitContextCount % 100 === 0) {
    console.warn(
      `[asyncGlobalState] factory engine state accessed outside runWithInstanceState() ` +
        `(${implicitContextCount} so far) — an implicit per-context state was created. ` +
        `Wrap the entry point in runWithInstanceState() so the store is scoped to the request.`,
    );
  }

  const created = newInstanceState();
  asyncLocalStorage.enterWith(created);
  return created;
}

/** Test/diagnostic hook: how many times state was created implicitly rather than via runWithInstanceState. */
function implicitContextCreations(): number {
  return implicitContextCount;
}

export default {
  addNotice,
  runWithInstanceState,
  implicitContextCreations,
  callListener,
  createInstanceState,
  cycleMutationStatus,
  deleteNotice,
  deleteNotices,
  disableNotifications,
  enableNotifications,
  getMethods,
  getNotices,
  getPayloads: getNotices, // canonical alias matching factory 5.0.0+
  getTopics,
  getTournamentId,
  getTournamentRecord,
  getTournamentRecords,
  removeTournamentRecord,
  setMethods,
  setSubscriptions,
  setTournamentId,
  setTournamentRecord,
  setTournamentRecords,
  handleCaughtError,
};

export function disableNotifications() {
  const instanceState = getInstanceState();
  instanceState.disableNotifications = true;
}

export function enableNotifications() {
  const instanceState = getInstanceState();
  instanceState.disableNotifications = false;
}

export function getTournamentId() {
  const instanceState = getInstanceState();
  return instanceState.tournamentId;
}

export function getTournamentRecord(tournamentId) {
  const instanceState = getInstanceState();
  return instanceState.tournamentRecords[tournamentId];
}

export function getTournamentRecords() {
  const instanceState = getInstanceState();
  return instanceState.tournamentRecords;
}

export function setTournamentRecord(tournamentRecord) {
  const tournamentId = tournamentRecord?.tournamentId;
  const instanceState = getInstanceState();
  instanceState.tournamentRecords[tournamentId] = tournamentRecord;
  return { ...SUCCESS };
}

export function setTournamentId(tournamentId) {
  const instanceState = getInstanceState();
  if (!tournamentId) {
    instanceState.tournamentId = undefined;
    return { ...SUCCESS };
  }
  if (instanceState.tournamentRecords[tournamentId]) {
    instanceState.tournamentId = tournamentId;
    return { ...SUCCESS };
  } else {
    return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };
  }
}

export function setTournamentRecords(tournamentRecords) {
  const instanceState = getInstanceState();
  instanceState.tournamentRecords = tournamentRecords;
  const tournamentIds = Object.keys(tournamentRecords);
  if (tournamentIds.length === 1) {
    instanceState.tournamentId = tournamentIds[0];
  } else if (!tournamentIds.length) {
    instanceState.tournamentId = undefined;
  }
}

export function removeTournamentRecord(tournamentId) {
  const instanceState = getInstanceState();
  if (typeof tournamentId !== 'string') return { error: INVALID_VALUES };
  if (!instanceState.tournamentRecords[tournamentId]) return { error: NOT_FOUND };

  delete instanceState.tournamentRecords[tournamentId];
  const tournamentIds = Object.keys(instanceState.tournamentRecords);
  if (tournamentIds.length === 1) {
    instanceState.tournamentId = tournamentIds[0];
  } else if (!tournamentIds.length) {
    instanceState.tournamentId = undefined;
  }
  return { ...SUCCESS };
}

function setSubscriptions(params) {
  if (typeof params?.subscriptions !== 'object') return { error: INVALID_VALUES };

  const instanceState = getInstanceState();

  Object.keys(params.subscriptions).forEach((subscription) => {
    instanceState.subscriptions[subscription] = params.subscriptions[subscription];
  });

  return { ...SUCCESS };
}

function setMethods(params) {
  if (typeof params !== 'object') return { error: INVALID_VALUES };
  const instanceState = getInstanceState();

  Object.keys(params).forEach((methodName) => {
    if (typeof params[methodName] !== 'function') return;
    instanceState.methods[methodName] = params[methodName];
  });
  return { ...SUCCESS };
}

function cycleMutationStatus() {
  const instanceState = getInstanceState();
  const status = instanceState.modified;
  instanceState.modified = false;
  return status;
}

function addNotice({ topic, payload, key }, isGlobalSubscription?: boolean) {
  if (typeof topic !== 'string' || typeof payload !== 'object') return;
  const instanceState = getInstanceState();
  // if there is a notice then the state has been modified, regardless of whether there is a subscription
  if (!instanceState.disableNotifications) instanceState.modified = true;
  if (instanceState.disableNotifications || (!instanceState.subscriptions[topic] && !isGlobalSubscription)) return;

  let outgoing = payload;

  if (key) {
    const retained: any[] = [];
    for (const notice of instanceState.notices) {
      if (notice.topic === topic && notice.key === key) {
        // Superseded — but its identity is still true of this key, so do not discard it. A later
        // emission often knows LESS: measured in factory, eight consecutive emissions for one drawId
        // carried eventId + tournamentId and the final one carried neither, so the delivered notice
        // was the only unroutable one in the batch. On the server that costs cache granularity
        // directly — an unattributable notice forces a tournament-wide sweep.
        //
        // Deliberately factory's helper, NOT a local copy: this provider reimplements the notice
        // buffer for per-request async isolation, and a second implementation of an identical rule is
        // how the two silently diverge.
        outgoing = globalState.preserveNoticeIdentity(outgoing, notice.payload);
      } else {
        retained.push(notice);
      }
    }
    instanceState.notices = retained;
  }
  // NOTE: when backend does not recognize undefined for updates
  // params = undefinedToNull(params) // => see object.js utils

  instanceState.notices.push({ topic, payload: outgoing, key });

  return { ...SUCCESS };
}

function getMethods() {
  const instanceState = getInstanceState();
  return instanceState.methods ?? {};
}

function getNotices({ topic }) {
  const instanceState = getInstanceState();
  return instanceState.notices.filter((notice) => notice.topic === topic).map((notice) => notice.payload);
}

function deleteNotices() {
  const instanceState = getInstanceState();
  instanceState.notices = [];
}

function deleteNotice({ key, topic }) {
  const instanceState = getInstanceState();
  instanceState.notices = instanceState.notices.filter(
    (notice) => (!topic || notice.topic === topic) && notice.key !== key,
  );
}

function getTopics() {
  const instanceState = getInstanceState();
  const topics = Object.keys(instanceState.subscriptions);
  return { topics };
}

async function callListener({ topic, payloads, notices }, globalSubscriptions?: any) {
  // factory 5.0.0 sends `payloads` as the canonical field; fall back to the
  // deprecated `notices` alias so this provider also works against pre-5.0.0
  // factory builds.
  const data = payloads ?? notices ?? [];
  const instanceState = getInstanceState();
  const method = instanceState.subscriptions[topic];
  if (method && typeof method === 'function') await method(data);
  const globalMethod = globalSubscriptions?.[topic];
  if (globalMethod && typeof globalMethod === 'function') await globalMethod(data);
}

export function handleCaughtError({ engineName, methodName, params, err }: any) {
  let error;
  if (typeof err === 'string') {
    error = err.toUpperCase();
  } else if (err instanceof Error) {
    error = err.message;
  }

  console.log('ERROR', {
    tournamentId: getTournamentId(),
    params: JSON.stringify(params),
    engine: engineName,
    methodName,
    error,
  });
}
