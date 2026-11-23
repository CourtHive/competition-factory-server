import { FootprintLocality } from './footprintLocality';

const limits = { durationMs: 1000, maxAgeMs: 900, reportMs: 200, maxEntries: 20, maxKeyBytes: 4096 };
function setup(changes: Partial<typeof limits> = {}) {
  const reports: Parameters<ConstructorParameters<typeof FootprintLocality>[1]>[0][] = [];
  const collector = new FootprintLocality({ ...limits, ...changes }, (r) => reports.push(r));
  return { collector, reports };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('separates same-version reuse, version changes, access-only repeats and durable invalidations across flushes', () => {
  const { collector, reports } = setup();
  const read = (version?: string) =>
    collector.observeAccess({
      kind: 'read',
      tournamentId: 'sensitive-person',
      drawIds: ['draw-secret'],
      version,
      eligible: true,
    });
  read('rev-a');
  read('rev-a');
  read('rev-b');
  read();
  vi.advanceTimersByTime(200);
  read('rev-b');
  collector.observeCommit('sensitive-person', 'save', 2048);
  read('rev-b');
  read('rev-b');
  collector.stop();
  for (const level of ['tournament', 'draw'] as const) {
    expect(reports[0][level]).toEqual({
      'read/eligible/unseenInHistory': 1,
      'read/eligible/versionMatched/0/1000': 1,
      'read/eligible/versionChanged/0/1000': 1,
      'read/eligible/accessProxy/0/1000': 1,
    });
    expect(reports[1][level]).toEqual({
      'read/eligible/accessProxy/0/1000': 1,
      'read/eligible/afterCommit/0/1000': 1,
      'read/eligible/versionMatched/0/1000': 1,
    });
  }
  expect(reports[1].commitSerializedCodeUnits).toEqual({ '4096': 1 });
  expect(JSON.stringify(reports)).not.toMatch(/sensitive-person|draw-secret|rev-[ab]/);
});

it('counts every intervening access, measures distinct named keys, and treats a multi-draw request as unordered', () => {
  const { collector, reports } = setup();
  const queue = (tournamentId: string, drawIds?: string[]) =>
    collector.observeAccess({ kind: 'queue', tournamentId, drawIds });
  queue('a', ['x', 'x', 'y']);
  queue('b', ['x']);
  queue('b', ['x']);
  queue('c');
  queue('a', ['y', 'x']);
  collector.stop();
  const [r] = reports;
  expect(r.requests).toEqual({ 'queue/unknown': 5 });
  expect(r.unknownDrawScope).toBe(1);
  expect(r.draw).toEqual({
    'queue/unknown/unseenInHistory': 3,
    'queue/unknown/accessProxy/0/1000': 1,
    'queue/unknown/accessProxy/1/1000': 2,
  });
  expect(r.drawAccessGaps['queue/unknown/accessProxy/3']).toBe(2);
  expect(r.tournament['queue/unknown/accessProxy/3/1000']).toBe(1); // 2 distinct, upper bound 3
  expect(r.tournamentAccessGaps['queue/unknown/accessProxy/3']).toBe(1);
});

it('invalidates only the committed tournament and treats missing commit identity conservatively', () => {
  const { collector, reports } = setup();
  const read = (id: string) =>
    collector.observeAccess({ kind: 'read', tournamentId: id, drawIds: ['same'], version: 0 });
  read('a');
  read('b');
  collector.observeCommit('a', 'delete');
  read('b');
  read('a');
  collector.observeCommit();
  read('b');
  collector.stop();
  expect(reports[0]).toMatchObject({ commits: 2, deletes: 1, unidentifiedCommits: 1 });
  for (const key of ['draw', 'tournament'] as const)
    expect(reports[0][key]).toEqual({
      'read/unknown/unseenInHistory': 2,
      'read/unknown/versionMatched/0/1000': 1,
      'read/unknown/afterCommit/1/1000': 2,
    });
});

it('evicts by count, retained bytes and age, including when traffic goes idle', () => {
  const { collector, reports } = setup({ maxEntries: 2, maxKeyBytes: 250, maxAgeMs: 150 });
  for (const id of ['a', 'b', 'c', 'a']) collector.observeAccess({ kind: 'read', tournamentId: id, drawIds: ['one'] });
  vi.advanceTimersByTime(200);
  expect(reports[0]).toMatchObject({
    tournamentEvictions: { count: 2, age: 2 },
    drawEvictions: { bytes: 3, age: 1 },
    resident: { draw: 0, tournament: 0, keyBytes: 0 },
  });
  collector.stop();
});

it('caps observations, preserves denominators for unknown footprints and keeps untrusted strings out of logs', () => {
  const { collector, reports } = setup({ durationMs: 90 });
  collector.observeAccess({ kind: 'read', tournamentId: '', recordBytes: 0 });
  collector.observeAccess({ kind: 'read', tournamentId: 'a', drawIds: Array(33).fill('private') });
  collector.observeAccess({ kind: 'queue', tournamentId: 'a', eligible: false, drawIds: ['x'.repeat(257)] });
  collector.observeAccess({ kind: 'queue', tournamentId: 'a', eligible: false, drawIds: [], recordBytes: 5_000 });
  vi.advanceTimersByTime(90);
  collector.observeCommit('a');
  vi.advanceTimersByTime(2000);
  collector.stop();
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    accesses: 4,
    final: true,
    unknownTournament: 1,
    unknownDrawScope: 3,
    oversizedDrawScope: 1,
    commits: 0,
    recordBytes: {
      'read/unknown/4096': 1,
      'read/unknown/unknown': 1,
      'queue/ineligible/16384': 1,
      'queue/ineligible/unknown': 1,
    },
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('continues collecting after a failed periodic log and releases on stop', () => {
  const emit = vi.fn().mockImplementationOnce(() => {
    throw new Error('sink');
  });
  const collector = new FootprintLocality(limits, emit);
  collector.observeAccess({ kind: 'read', tournamentId: 'a' });
  vi.advanceTimersByTime(200);
  collector.observeAccess({ kind: 'queue', tournamentId: 'b' });
  collector.stop();
  expect(emit.mock.calls[1][0]).toMatchObject({ failedReports: 1, accesses: 2, final: true });
});

it('allocates no disabled timer and detaches the configured worker after its finite window', async () => {
  try {
    vi.stubEnv('FOOTPRINT_LOCALITY_ENABLED', undefined);
    vi.resetModules();
    expect((await import('./footprintLocality')).footprintLocality).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.stubEnv('FOOTPRINT_LOCALITY_ENABLED', 'true');
    vi.stubEnv('FOOTPRINT_LOCALITY_WINDOW_MS', '75');
    vi.resetModules();
    const worker = await import('./footprintLocality');
    expect(worker.footprintLocality).toBeDefined();
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(75);
    expect(worker.footprintLocality).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});
