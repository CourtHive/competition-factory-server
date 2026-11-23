import { configuredShardBodyCache, drawBodyKey, ShardBodyCache, type ShardBodyLocation } from './shardBodyCache';

const shell = { kind: 'shell' } as const;
const participant = (ord: number): ShardBodyLocation => ({ kind: 'participant', ord });
const draw = (eventOrd: number, ord: number, eventId = 'event', drawId = 'draw'): ShardBodyLocation => ({
  kind: 'draw',
  eventOrd,
  ord,
  eventId,
  drawId,
});
const fresh = (cache: ShardBodyCache, id = 't') => cache.snapshot(id, ['draw'], undefined, true);
const doc = '{"value":{"names":["日本","é","😀"]}}';
type Document = { value: { names: string[] } };

function weight(id: string, where: ShardBodyLocation, text = doc) {
  const cache = new ShardBodyCache(1_000_000);
  cache.put(id, where, '1', text);
  return cache.retainedBytes;
}
function version(cache: ShardBodyCache, id: string) {
  const snapshot = fresh(cache, id);
  try {
    return snapshot.shell?.token;
  } finally {
    snapshot.release();
  }
}

it('requires a positive integral configured budget and defaults off', () => {
  try {
    vi.stubEnv('CFS_SHARD_CACHE_BYTES', undefined);
    expect(configuredShardBodyCache()).toBeUndefined();
    for (const text of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', 'one']) {
      expect(configuredShardBodyCache(text)).toBeUndefined();
    }
    vi.stubEnv('CFS_SHARD_CACHE_BYTES', ' 1024 ');
    expect(configuredShardBodyCache()).toBeInstanceOf(ShardBodyCache);
    expect(new ShardBodyCache(0).enabled).toBe(false);
    expect(new ShardBodyCache(512).enabled).toBe(true);
    expect(() => new ShardBodyCache(-1)).toThrow(RangeError);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('selects by stored draw labels and event siblings but keys every body by its physical row within a tournament', () => {
  const cache = new ShardBodyCache(100_000);
  cache.put('t', shell, 'shell', doc);
  cache.put('t', draw(0, 0), 'first', doc);
  cache.put('t', draw(0, 1, 'event', 'other'), 'sibling', doc);
  cache.put('t', draw(1, 0, 'otherEvent', 'draw'), 'duplicate logical id', doc);
  cache.put('t', draw(1, 1, 'otherEvent', 'other'), 'unselected', doc);
  cache.put('t', participant(0), 'ordinal zero', doc);
  cache.put('t', participant(1), 'ordinal one', doc);
  cache.put('other', draw(0, 0), 'other-tournament', doc);
  const scoped = cache.snapshot('t', ['draw'], 'event', true);
  expect(scoped.shell?.token).toBe('shell');
  expect([...scoped.draws].map(([key, h]) => [key, h.token])).toEqual([
    [drawBodyKey(0, 0), 'first'],
    [drawBodyKey(0, 1), 'sibling'],
    [drawBodyKey(1, 0), 'duplicate logical id'],
  ]);
  expect([...scoped.participants].map(([key, h]) => [key, h.token])).toEqual([
    [0, 'ordinal zero'],
    [1, 'ordinal one'],
  ]);
  scoped.release();
  const narrow = cache.snapshot('t', ['other'], undefined, false);
  expect([...narrow.draws.keys()]).toEqual(['0/1', '1/1']);
  expect(narrow.participants.size).toBe(0);
  narrow.release();
  const foreign = fresh(cache, 'other');
  expect(foreign.draws.get('0/0')?.token).toBe('other-tournament');
  foreign.release();
});

it('parses privately for each use and isolates the stored locator from caller mutation', () => {
  const cache = new ShardBodyCache(100_000);
  const at = { kind: 'draw' as const, eventId: 'event', eventOrd: 0, ord: 0, drawId: 'draw' };
  cache.put('t', at, '1', doc);
  at.drawId = 'wrong';
  for (const where of [shell, participant(0)]) cache.put('t', where, '1', doc);
  const a = fresh(cache);
  const b = fresh(cache);
  for (const get of [
    (x: typeof a) => x.shell!,
    (x: typeof a) => x.draws.get('0/0')!,
    (x: typeof a) => x.participants.get(0)!,
  ]) {
    const changed = get(a).parse<Document>();
    changed.value.names.splice(0);
    expect(get(a).parse<Document>()).toEqual(JSON.parse(doc));
    expect(get(b).parse<Document>()).toEqual(JSON.parse(doc));
  }
  a.release();
  b.release();
});

it('uses one byte LRU across all parts and tournaments; only consumed hits promote', () => {
  const weights = [weight('a', shell), weight('b', draw(0, 0)), weight('c', participant(0))];
  const budget = weights.reduce((sum, n) => sum + n, 0);
  const cache = new ShardBodyCache(budget);
  cache.put('a', shell, '1', doc);
  cache.put('b', draw(0, 0), '1', doc);
  cache.put('c', participant(0), '1', doc);
  expect(cache.retainedBytes).toBe(budget);
  const touch = fresh(cache, 'a');
  touch.shell!.parse();
  touch.release();
  fresh(cache, 'b').release(); // an unused hint cannot turn b into the MRU
  cache.put('d', shell, '1', doc);
  expect(cache.retainedBytes).toBeLessThanOrEqual(budget);
  expect(cache.tournamentCount).toBe(3);
  const b = fresh(cache, 'b');
  expect(b.draws.size).toBe(0);
  b.release();
  expect(version(cache, 'a')).toBe('1');
  expect(version(cache, 'd')).toBe('1');
  const c = fresh(cache, 'c');
  expect(c.participants.get(0)?.token).toBe('1');
  c.release();
});

it('charges exact UTF-8 body bytes and retained key/token material before admission', () => {
  const small = '"aa"';
  const unicode = '"😀"'; // same JS string length, two more bytes on the wire
  const bytes = weight('t', shell, small);
  expect(weight('t', shell, unicode)).toBe(bytes + 2);
  expect(weight('tt', shell, small)).toBeGreaterThan(bytes);
  const exact = new ShardBodyCache(bytes);
  exact.put('t', shell, '1', small);
  exact.put('u', shell, '1', unicode);
  exact.put('u', shell, '2'.repeat(3_000), small);
  exact.put('x'.repeat(3_000), draw(10, 3), '1', small);
  expect(exact.retainedBytes).toBe(bytes);
  expect(exact.tournamentCount).toBe(1);
  expect(version(exact, 't')).toBe('1');
  expect(version(exact, 'u')).toBeUndefined();
  exact.put('t', shell, '2', unicode);
  expect(exact.retainedBytes).toBe(0);
  expect(exact.tournamentCount).toBe(0);
});

it('pins the exact validated body across a SELECT even while its live slot moves twice', async () => {
  const cache = new ShardBodyCache(15_000);
  cache.put('t', shell, '1', doc);
  const snap = fresh(cache);
  const handle = snap.shell!;
  let resume!: () => void;
  const select = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const waiting = (async () => {
    const offered = handle.token;
    await select;
    expect(offered).toBe('1');
    return handle.parse<Document>();
  })();
  cache.put('t', shell, '2', '{"generation":2}');
  const second = fresh(cache);
  cache.put('t', shell, '3', '{"generation":3}');
  expect(second.shell!.parse()).toEqual({ generation: 2 });
  expect(version(cache, 't')).toBe('3');
  resume();
  expect(await waiting).toEqual(JSON.parse(doc));
  snap.release();
  second.release();
  snap.release();
  expect(() => handle.parse()).toThrow('released');
  expect(cache.retainedBytes).toBe(weight('t', shell, '{"generation":3}'));
});

it('counts outstanding leases under pressure and retires a pinned evicted version until its last reader releases', () => {
  const base = weight('t', shell);
  const cache = new ShardBodyCache(base + 500);
  cache.put('t', shell, '1', doc);
  const pinned = fresh(cache);
  const overlap = fresh(cache);
  expect(overlap.shell?.token).toBe('1');
  const peak = cache.retainedBytes;
  expect(peak).toBeGreaterThan(base);
  const excess = fresh(cache);
  expect(excess.shell).toBeUndefined();
  excess.release();
  cache.put('t', shell, '2', doc);
  expect(cache.tournamentCount).toBe(0);
  expect(cache.retainedBytes).toBe(peak);
  cache.put('u', shell, '1', doc);
  expect(cache.retainedBytes).toBe(peak);
  expect(overlap.shell!.parse()).toEqual(JSON.parse(doc));
  pinned.release();
  expect(cache.retainedBytes).toBe(base);
  overlap.release();
  expect(cache.retainedBytes).toBe(0);
  cache.put('u', shell, '1', doc);
  expect(version(cache, 'u')).toBe('1');
});

it('does not retroactively supply hints to concurrent misses or retain duplicate fills of the same version', async () => {
  const cache = new ShardBodyCache(weight('t', shell));
  const fills = Array.from({ length: 40 }, async () => {
    const miss = fresh(cache);
    await Promise.resolve();
    expect(miss.shell).toBeUndefined();
    cache.put('t', shell, '1', doc);
    miss.release();
  });
  await Promise.all(fills);
  expect(cache.retainedBytes).toBe(weight('t', shell));
  for (let i = 0; i < 30; i++) {
    const id = String.fromCharCode(65 + i);
    cache.put(id, shell, '1', doc);
    expect(cache.tournamentCount).toBe(1);
    expect(cache.retainedBytes).toBe(weight('t', shell));
  }
});
