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

/**
 * Keyed notices coalesce: a later notice with the same topic+key replaces the earlier one. That is
 * intentional — one notice per entity per mutation. Replacing WHOLESALE was not: a later emission
 * often knows LESS, and it used to destroy identity the system already had.
 *
 * Measured in factory on one generated draw — eight consecutive emissions carried eventId and
 * tournamentId, the final one carried neither, and the final one is what a subscriber received. On the
 * server that directly costs cache granularity: an unattributable notice forces a tournament-wide
 * sweep instead of a per-event eviction.
 *
 * This provider hand-implements the same buffer as factory's `syncGlobalState`, so the behaviour has
 * to be asserted here too — fixing only factory would leave the SERVER path, the one that actually
 * drives invalidation, on the old behaviour.
 */
describe('asyncGlobalState — keyed notice de-dup preserves identity', () => {
  it('a later notice missing identity inherits it from the one it supersedes', async () => {
    await asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.setSubscriptions({ subscriptions: { modifyDrawDefinition: () => undefined } });

      asyncGlobalState.addNotice({
        topic: 'modifyDrawDefinition',
        payload: { tournamentId: 't1', eventId: 'e1', drawDefinition: { drawId: 'd1', v: 1 } },
        key: 'd1',
      });
      asyncGlobalState.addNotice({
        topic: 'modifyDrawDefinition',
        payload: { drawDefinition: { drawId: 'd1', v: 2 } },
        key: 'd1',
      });

      const notices = asyncGlobalState.getNotices({ topic: 'modifyDrawDefinition' });
      expect(notices).toHaveLength(1); // coalescing still happens
      expect(notices[0].drawDefinition.v).toEqual(2); // last writer still wins for the ENTITY
      expect(notices[0].eventId).toEqual('e1'); // ...but identity survives
      expect(notices[0].tournamentId).toEqual('t1');
    });
  });

  it('never overwrites identity the later notice supplied itself', async () => {
    await asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.setSubscriptions({ subscriptions: { modifyDrawDefinition: () => undefined } });

      asyncGlobalState.addNotice({ topic: 'modifyDrawDefinition', payload: { eventId: 'OLD' }, key: 'd1' });
      asyncGlobalState.addNotice({ topic: 'modifyDrawDefinition', payload: { eventId: 'NEW' }, key: 'd1' });

      expect(asyncGlobalState.getNotices({ topic: 'modifyDrawDefinition' })[0].eventId).toEqual('NEW');
    });
  });

  it('does not bleed identity between different keys', async () => {
    await asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.setSubscriptions({ subscriptions: { modifyDrawDefinition: () => undefined } });

      asyncGlobalState.addNotice({ topic: 'modifyDrawDefinition', payload: { eventId: 'e1' }, key: 'd1' });
      asyncGlobalState.addNotice({ topic: 'modifyDrawDefinition', payload: {}, key: 'd2' });

      const notices = asyncGlobalState.getNotices({ topic: 'modifyDrawDefinition' });
      expect(notices).toHaveLength(2);
      expect(notices.filter((n: any) => n.eventId === 'e1')).toHaveLength(1);
    });
  });

  it('preserves the full identity field set, including sanctioning origin', async () => {
    // origin* has been on the wire since factory 6.27.0; dropping it would lose the ability to
    // attribute a change to the sanctioning owner, which is the whole point of carrying it.
    await asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.setSubscriptions({ subscriptions: { modifyMatchUp: () => undefined } });

      asyncGlobalState.addNotice({
        topic: 'modifyMatchUp',
        payload: {
          tournamentId: 't1',
          eventId: 'e1',
          drawId: 'd1',
          structureId: 's1',
          originOrganisationId: 'o1',
          originTournamentId: 'ot1',
          originEventId: 'oe1',
          originDrawId: 'od1',
          matchUp: { matchUpId: 'm1' },
        },
        key: 'm1',
      });
      asyncGlobalState.addNotice({
        topic: 'modifyMatchUp',
        payload: { matchUp: { matchUpId: 'm1', scored: true } },
        key: 'm1',
      });

      const [notice] = asyncGlobalState.getNotices({ topic: 'modifyMatchUp' });
      for (const field of [
        'tournamentId',
        'eventId',
        'drawId',
        'structureId',
        'originOrganisationId',
        'originTournamentId',
        'originEventId',
        'originDrawId',
      ]) {
        expect({ field, value: notice[field] }).toEqual({ field, value: expect.any(String) });
      }
      expect(notice.matchUp.scored).toEqual(true);
    });
  });
});

/**
 * Anti-duplication guard, mirroring the one in factory's noticeIdentityPreservation test.
 *
 * Factory's guard is repo-local, so it cannot see this file. Without an equivalent here, nothing stops
 * this provider re-growing its own copy of the merge — which is exactly how it diverged the first
 * time: the whole notice buffer was hand-copied from factory, flaw included.
 */
describe('asyncGlobalState — no local copy of the identity merge', () => {
  it("de-dups via factory's exported helper, never a local reimplementation", async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, 'asyncGlobalState.ts'), 'utf8');

    // it de-duplicates by key...
    expect(src).toMatch(/notice\.topic === topic && notice\.key === key/);
    // ...so it must route through the shared helper
    expect(src).toContain('globalState.preserveNoticeIdentity');
    // and must NOT carry its own field list or merge function
    expect(src).not.toContain('NOTICE_IDENTITY_FIELDS =');
    expect(src).not.toMatch(/function preserveIdentity|function preserveNoticeIdentity/);
  });
});
