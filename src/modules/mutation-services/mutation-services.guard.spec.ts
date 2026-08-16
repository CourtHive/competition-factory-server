import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { MutationServicesService, REQUEST_SCOPED_SERVICE_KEYS } from './mutation-services.service';

const EXECUTION_QUEUE_PATH = join(__dirname, '../factory/functions/private/executionQueue.ts');
const GATEWAY_PATH = join(__dirname, '../messaging/tmx/tmx.gateway.ts');
const FACTORY_SERVICE_PATH = join(__dirname, '../factory/factory.service.ts');

/** Every `services.x` / `services?.x` key executionQueue actually reads. */
function servicesKeysReadByExecutionQueue(): string[] {
  const source = readFileSync(EXECUTION_QUEUE_PATH, 'utf-8');
  const keys = new Set<string>();
  for (const match of source.matchAll(/\bservices\??\.([a-zA-Z_$][\w$]*)/g)) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

function makeService() {
  const projectionOutbox: any = { isEnabled: false, enqueue: jest.fn() };
  const loadProfile: any = { record: jest.fn(), isEnabled: false };
  return new MutationServicesService(projectionOutbox, loadProfile);
}

/**
 * STRUCTURAL GUARD for the executionQueue services bag.
 *
 * The bag was previously assembled independently at each mutation entry point,
 * and diverged without any symptom: the WebSocket path supplied
 * `projectionOutbox` and the REST path did not, so every REST/provisioner
 * mutation silently produced no read-model deltas. No error, no log, no failing
 * test — the read model just quietly stopped learning about those mutations.
 *
 * These tests exist so that failure mode cannot recur. They read the real
 * source rather than a fixture, so adding a new `services?.foo` read to
 * executionQueue fails here until it is wired into MutationServicesService or
 * declared request-scoped.
 */
describe('executionQueue services bag — divergence guard', () => {
  it('finds the services keys executionQueue reads (guard is actually looking at something)', () => {
    const keys = servicesKeysReadByExecutionQueue();

    // If this ever returns nothing, the regex has drifted from the source and
    // every other test in this file would vacuously pass.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain('projectionOutbox');
  });

  it('supplies every server-owned key executionQueue reads', () => {
    const built = makeService().build();
    const requestScoped = new Set<string>(REQUEST_SCOPED_SERVICE_KEYS);

    const missing = servicesKeysReadByExecutionQueue().filter(
      (key) => !requestScoped.has(key) && !(key in built),
    );

    // A key here means executionQueue reads something no call site is
    // guaranteed to provide — exactly the projectionOutbox bug, recurring.
    expect(missing).toEqual([]);
  });

  it('declares request-scoped keys that executionQueue actually reads', () => {
    const read = new Set(servicesKeysReadByExecutionQueue());
    const stale = REQUEST_SCOPED_SERVICE_KEYS.filter((key) => !read.has(key));

    // Keeps the allowlist honest: a key that stops being read must not linger
    // as a permanent hole in the guard.
    expect(stale).toEqual([]);
  });

  it('never lets a request-scoped key silently override a server-owned one', () => {
    const service = makeService();
    const built: any = service.build({ cacheManager: 'from-caller' });

    expect(built.cacheManager).toBe('from-caller');
    expect(built.projectionOutbox).toBeDefined();
    expect(built.loadProfile).toBeDefined();
  });

  it('builds the same server-owned keys with or without request-scoped input', () => {
    const service = makeService();

    const bare = Object.keys(service.build()).sort();
    const withRequest = Object.keys(service.build({ cacheManager: {}, trackCacheKey: jest.fn() })).sort();

    const requestScoped = new Set<string>(REQUEST_SCOPED_SERVICE_KEYS);
    expect(withRequest.filter((k) => !requestScoped.has(k))).toEqual(bare.filter((k) => !requestScoped.has(k)));
  });
});

/**
 * The bag must be assembled through the builder, never as a literal. A future
 * call site that hand-rolls `services: { ... }` reintroduces the divergence no
 * matter how correct the builder is, so assert both entry points route through
 * it.
 */
describe('mutation entry points route through the builder', () => {
  it.each([
    ['tmx.gateway.ts', GATEWAY_PATH],
    ['factory.service.ts', FACTORY_SERVICE_PATH],
  ])('%s builds its services bag via MutationServicesService', (_name, path) => {
    const source = readFileSync(path, 'utf-8');
    expect(source).toContain('mutationServices.build(');
  });

  it('neither entry point passes projectionOutbox as a hand-rolled literal', () => {
    for (const path of [GATEWAY_PATH, FACTORY_SERVICE_PATH]) {
      const source = readFileSync(path, 'utf-8');
      // `services: { ... projectionOutbox ... }` is the exact shape that
      // diverged. The builder owns this key now.
      expect(source).not.toMatch(/services:\s*\{[^}]*projectionOutbox/);
    }
  });
});

/**
 * The entry-point checks above only cover the two call sites we knew about.
 * Falsifying this guard turned up two MORE mutation paths that had been passing
 * `undefined` or a partial literal for services — `applyParticipantPrivacyToExisting`
 * and `score()` in FactoryService, plus the draw-restore path in AuditService.
 * Each saved a record and produced no read-model delta.
 *
 * So the guard scans every non-spec caller of the private mutation functions,
 * rather than an enumerated list that can go stale the same way the bag did.
 */
describe('no mutation path supplies a partial services bag', () => {
  const PRIVATE_MUTATION_ENTRYPOINTS = ['functions/private/executionQueue', 'functions/private/setMatchUpStatus'];

  function sourceFilesImportingMutationEntrypoints(): { path: string; source: string }[] {
    const root = join(__dirname, '..', '..');
    const found: { path: string; source: string }[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name.includes('.spec.') || entry.name.includes('.e2e.')) continue;
        // The definitions themselves are not callers.
        if (PRIVATE_MUTATION_ENTRYPOINTS.some((e) => full.includes(e))) continue;

        const source = readFileSync(full, 'utf-8');
        if (PRIVATE_MUTATION_ENTRYPOINTS.some((e) => source.includes(e))) found.push({ path: full, source });
      }
    };

    walk(root);
    return found;
  }

  it('finds the callers (guard is actually looking at something)', () => {
    const callers = sourceFilesImportingMutationEntrypoints();

    // Vacuous-pass protection: if the walk finds nothing, every assertion below
    // trivially succeeds and the guard is decorative.
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.map((c) => c.path).join('|')).toContain('factory.service.ts');
  });

  it('never passes undefined as the services argument', () => {
    const offenders = sourceFilesImportingMutationEntrypoints()
      // `executionQueue(\n  {...},\n  undefined,` — the services slot is the
      // second argument, so an `undefined,` line directly after the payload
      // object is the shape being banned.
      .filter(({ source }) => /(?:executionQueue|\beq|setMatchUpStatus)\([\s\S]{0,600}?\n\s*undefined,/.test(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('never hand-rolls a bare { cacheManager } bag', () => {
    const offenders = sourceFilesImportingMutationEntrypoints()
      .filter(({ source }) => /\n\s*\{\s*cacheManager\s*\},/.test(source))
      .map(({ path }) => path);

    // `{ cacheManager }` alone is precisely what score() passed — enough to make
    // caching work and enough to silently lose the outbox.
    expect(offenders).toEqual([]);
  });
});
