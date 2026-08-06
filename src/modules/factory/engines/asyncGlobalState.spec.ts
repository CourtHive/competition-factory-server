import asyncGlobalState from './asyncGlobalState';

/**
 * Regression coverage for the per-request isolation defect (competition-factory#4564).
 *
 * The provider previously keyed state by `executionAsyncId()` with an async_hooks `init` hook,
 * and `getMutationEngine.ts` seeded it ONCE at module scope. The result was a single state
 * object shared by every request in the process — verified in prod by the total absence of
 * `Can not get instance state` errors: it never threw because it never isolated.
 *
 * The load-bearing case is `readClobbersInFlightMutation` below. The mutation path does
 *
 *     mutationEngine.setState(records)          // sync
 *     await mutationEngine.executionQueue(...)  // async — the window
 *     mutationEngine.getState().tournamentRecords
 *
 * so any concurrent reader calling `setState` during that await replaces the records the
 * mutation is working on. That needs one mutation plus one ordinary read, not the rare
 * cross-tournament mutation concurrency.
 */

const record = (tournamentId: string) => ({ tournamentId, tournamentName: `T-${tournamentId}` });
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('asyncGlobalState per-context isolation', () => {
  it('concurrent contexts do not share tournamentRecords', async () => {
    const request = (tag: string) =>
      asyncGlobalState.runWithInstanceState(async () => {
        asyncGlobalState.setTournamentRecord(record(tag));
        await tick(5);
        return Object.keys(asyncGlobalState.getTournamentRecords());
      });

    const [a, b, c] = await Promise.all([request('A'), request('B'), request('C')]);

    expect(a).toEqual(['A']);
    expect(b).toEqual(['B']);
    expect(c).toEqual(['C']);
  });

  it('a concurrent read does not clobber an in-flight mutation (vector 3)', async () => {
    const mutation = asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.setTournamentRecord(record('MUTATION'));
      await tick(20); // stands in for `await mutationEngine.executionQueue(...)`
      return Object.keys(asyncGlobalState.getTournamentRecords());
    });

    const read = asyncGlobalState.runWithInstanceState(async () => {
      await tick(5); // lands inside the mutation's await window
      asyncGlobalState.setTournamentRecord(record('READ'));
      return Object.keys(asyncGlobalState.getTournamentRecords());
    });

    const [mutationRecords, readRecords] = await Promise.all([mutation, read]);

    expect(mutationRecords).toEqual(['MUTATION']);
    expect(readRecords).toEqual(['READ']);
  });

  it('context survives every await shape', async () => {
    const shapes: [string, () => Promise<unknown>][] = [
      ['await null', async () => null],
      ['await Promise.resolve()', async () => Promise.resolve()],
      ['await setTimeout', async () => tick(1)],
      ['await setImmediate', async () => new Promise((resolve) => setImmediate(resolve))],
      ['await Promise.all', async () => Promise.all([Promise.resolve(1), Promise.resolve(2)])],
    ];

    for (const [label, shape] of shapes) {
      const result = await asyncGlobalState.runWithInstanceState(async () => {
        asyncGlobalState.setTournamentRecord(record('X'));
        await shape();
        return Object.keys(asyncGlobalState.getTournamentRecords());
      });
      expect(result).toEqual(['X']); // context lost after: ${label}
      expect(label).toBeDefined();
    }
  });

  it('subscriptions registered in one context are not visible in another', async () => {
    // the notice mis-delivery mechanism: getMutationEngine calls setSubscriptions per request
    // with handlers closing over that request's publicNotices array
    const delivered: string[] = [];

    const request = (tag: string) =>
      asyncGlobalState.runWithInstanceState(async () => {
        asyncGlobalState.setSubscriptions({ subscriptions: { modifyMatchUp: () => delivered.push(tag) } });
        await tick(5);
        await asyncGlobalState.callListener({ topic: 'modifyMatchUp', payloads: [{}], notices: undefined });
        return asyncGlobalState.getTopics().topics;
      });

    const [a, b] = await Promise.all([request('A'), request('B')]);

    expect(a).toEqual(['modifyMatchUp']);
    expect(b).toEqual(['modifyMatchUp']);
    expect([...delivered].sort((x, y) => x.localeCompare(y))).toEqual(['A', 'B']);
  });

  it('notices do not leak between concurrent contexts', async () => {
    const request = (tag: string) =>
      asyncGlobalState.runWithInstanceState(async () => {
        // addNotice is a no-op for topics with no subscription in the current context
        asyncGlobalState.setSubscriptions({ subscriptions: { modifyMatchUp: () => undefined } });
        asyncGlobalState.addNotice({ topic: 'modifyMatchUp', payload: { tag }, key: undefined });
        await tick(5);
        return asyncGlobalState.getNotices({ topic: 'modifyMatchUp' }).map((payload: any) => payload.tag);
      });

    const [a, b] = await Promise.all([request('A'), request('B')]);

    expect(a).toEqual(['A']);
    expect(b).toEqual(['B']);
  });

  it('nested contexts do not bleed into the parent', async () => {
    const result = await asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.setTournamentRecord(record('OUTER'));
      await asyncGlobalState.runWithInstanceState(async () => {
        asyncGlobalState.setTournamentRecord(record('INNER'));
      });
      return Object.keys(asyncGlobalState.getTournamentRecords());
    });

    expect(result).toEqual(['OUTER']);
  });

  it('DOCUMENTS THE LIMIT: implicit creation is a safety net, NOT isolation', async () => {
    // Unwrapped siblings launched from a COMMON parent context still share: the first access
    // binds a store to that shared parent via `enterWith`, and the sibling inherits it. Implicit
    // creation only guarantees that state is scoped to a context SUBTREE instead of living
    // process-wide forever — strictly better than the defect, but not a substitute for wrapping.
    //
    // This is why every real entry point (executionQueue, queryTournamentRecords, projection
    // rebuild, mock generation) calls runWithInstanceState explicitly. Do not rely on the net.
    const before = asyncGlobalState.implicitContextCreations();

    const unwrapped = (tag: string) =>
      (async () => {
        asyncGlobalState.setTournamentRecord(record(tag));
        await tick(5);
        return Object.keys(asyncGlobalState.getTournamentRecords());
      })();

    const [a, b] = await Promise.all([unwrapped('A'), unwrapped('B')]);

    expect(a).toEqual(['A', 'B']); // shared — the documented limit
    expect(b).toEqual(['A', 'B']);

    // wrapping the SAME calls restores isolation
    const wrapped = (tag: string) =>
      asyncGlobalState.runWithInstanceState(async () => {
        asyncGlobalState.setTournamentRecord(record(tag));
        await tick(5);
        return Object.keys(asyncGlobalState.getTournamentRecords());
      });
    expect(await Promise.all([wrapped('A'), wrapped('B')])).toEqual([['A'], ['B']]);

    // and the implicit path is reported, not silent
    expect(asyncGlobalState.implicitContextCreations()).toBeGreaterThan(before);
  });

  it('an implicit context survives an await, so setState → await → getState stays coherent', async () => {
    const result = await (async () => {
      asyncGlobalState.setTournamentRecord(record('IMPLICIT'));
      await tick(5);
      return Object.keys(asyncGlobalState.getTournamentRecords());
    })();

    expect(result).toEqual(['IMPLICIT']);
  });
});
