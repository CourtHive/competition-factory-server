/**
 * Expression dual-stream smoke test.
 *
 * Boots a real HTTP server in-process, registers it as a scorebug
 * consumer in ConsumerRegistryService, and verifies that the full
 * orchestration of ProjectorService + ScorebugTickService delivers
 * BOTH:
 *
 *   1. event payloads (`kind: 'event'`) on every projector dispatch
 *   2. tick payloads (`kind: 'tick'`) at sub-second cadence while the
 *      bolt is in the `play` state
 *
 * Uses real timers and real HTTP to exercise the same code paths a
 * production Expression consumer would hit. The tick interval is set
 * to 80ms via env so a single test run takes ~1s wall-clock total.
 *
 * Spec covers:
 * - dual stream during a running bolt (event + multiple ticks)
 * - tick stream stops when bolt is paused
 * - no ticks fire when bolt is in pre state (boltStarted = false)
 * - cleanup on module destroy
 */
import { createServer, Server as HttpServer } from 'http';

import { ConsumerRegistryService } from './consumer-registry.service';
import { ProjectorService } from './projector.service';
import { ScorebugTickService } from './scorebug-tick.service';
import { buildMidBoltHistory, buildSampleBoltHistory } from './fixtures/sample-bolt-history';

interface CapturedPayload {
  kind?: string;
  matchUpId?: string;
  tournamentId?: string;
  state?: string;
  boltClockMs?: number;
  serveClockMs?: number;
  generatedAt?: string;
  // Allow any other fields
  [key: string]: unknown;
}

describe('Expression dual-stream smoke test', () => {
  let httpServer: HttpServer;
  let port: number;
  let receivedPayloads: CapturedPayload[];
  let registry: ConsumerRegistryService;
  let tickService: ScorebugTickService;
  let projector: ProjectorService;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    process.env.SCOREBUG_TICK_INTERVAL_MS = '80';
    receivedPayloads = [];

    httpServer = createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          if (body) receivedPayloads.push(JSON.parse(body));
        } catch {
          // ignore parse errors in the smoke test stub
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('failed to bind');
    port = address.port;

    registry = new ConsumerRegistryService();
    tickService = new ScorebugTickService(registry);
    projector = new ProjectorService(registry, tickService);

    registry.register({
      id: 'expression-smoke',
      kind: 'scorebug',
      url: `http://localhost:${port}/scorebug`,
      enabled: true,
    });
  });

  afterEach(async () => {
    tickService.onModuleDestroy();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.env = { ...ORIGINAL_ENV };
  });

  function ticks(): CapturedPayload[] {
    return receivedPayloads.filter((p) => p.kind === 'tick');
  }

  function events(): CapturedPayload[] {
    return receivedPayloads.filter((p) => p.kind === 'event');
  }

  it('delivers a single event payload + multiple tick payloads while a bolt is running', async () => {
    await projector.project(buildMidBoltHistory());

    // Wait long enough for ~5 tick cycles at 80ms cadence (plus a buffer
    // for in-flight async fetches to settle)
    await new Promise((r) => setTimeout(r, 480));

    expect(events()).toHaveLength(1);
    expect(events()[0].kind).toBe('event');
    expect(events()[0].matchUpId).toBe('tie-sample-1');
    expect(events()[0].tournamentId).toBe('tour-sample-1');

    // Expect at least 4 ticks at 80ms cadence over ~400ms
    expect(ticks().length).toBeGreaterThanOrEqual(4);
    const firstTick = ticks()[0];
    expect(firstTick.kind).toBe('tick');
    expect(firstTick.matchUpId).toBe('tie-sample-1');
    expect(firstTick.tournamentId).toBe('tour-sample-1');
    expect(firstTick.state).toBe('play');
    expect(typeof firstTick.boltClockMs).toBe('number');
    expect(typeof firstTick.serveClockMs).toBe('number');
  });

  it('clock countdown extrapolates downward across ticks', async () => {
    // Mid-bolt fixture has boltClockRemainingMs: 420000
    await projector.project(buildMidBoltHistory());
    await new Promise((r) => setTimeout(r, 400));

    const tickValues = ticks().map((t) => t.boltClockMs as number);
    expect(tickValues.length).toBeGreaterThanOrEqual(3);
    // Each subsequent tick should be lower than (or equal to) the previous
    for (let i = 1; i < tickValues.length; i++) {
      expect(tickValues[i]).toBeLessThanOrEqual(tickValues[i - 1]);
    }
    // The last tick should be meaningfully lower than the starting clock
    expect(tickValues[tickValues.length - 1]).toBeLessThan(420000);
  });

  it('stops ticking when the bolt transitions to paused', async () => {
    await projector.project(buildMidBoltHistory());
    await new Promise((r) => setTimeout(r, 250));
    const ticksBeforePause = ticks().length;
    expect(ticksBeforePause).toBeGreaterThan(0);

    await projector.project({ ...buildMidBoltHistory(), pausedOnExit: true });
    // Allow one event dispatch + brief settle
    await new Promise((r) => setTimeout(r, 100));
    const ticksImmediatelyAfterPause = ticks().length;

    // Wait through several cycles that would-have-fired
    await new Promise((r) => setTimeout(r, 400));

    expect(ticks().length).toBe(ticksImmediatelyAfterPause);
    // The pause itself emitted an event payload
    expect(events().length).toBe(2);
    expect(events()[1].kind).toBe('event');
  });

  it('does not start ticking when bolt is in the pre state', async () => {
    await projector.project(buildSampleBoltHistory({ boltStarted: false }));
    await new Promise((r) => setTimeout(r, 300));

    expect(ticks()).toHaveLength(0);
    // But the event payload still arrived
    expect(events()).toHaveLength(1);
    expect(events()[0].kind).toBe('event');
  });

  it('stops ticking when the bolt completes', async () => {
    await projector.project(buildMidBoltHistory());
    await new Promise((r) => setTimeout(r, 250));
    const ticksBeforeComplete = ticks().length;
    expect(ticksBeforeComplete).toBeGreaterThan(0);

    await projector.project({ ...buildMidBoltHistory(), boltComplete: true });
    await new Promise((r) => setTimeout(r, 100));
    const ticksImmediatelyAfter = ticks().length;
    await new Promise((r) => setTimeout(r, 300));

    expect(ticks().length).toBe(ticksImmediatelyAfter);
  });

  it('resumes ticking after a pause/resume cycle', async () => {
    await projector.project(buildMidBoltHistory());
    await new Promise((r) => setTimeout(r, 200));

    // Pause
    await projector.project({ ...buildMidBoltHistory(), pausedOnExit: true });
    await new Promise((r) => setTimeout(r, 100));
    const ticksAtPause = ticks().length;

    // Resume — pausedOnExit clears
    await projector.project({ ...buildMidBoltHistory(), pausedOnExit: false });
    await new Promise((r) => setTimeout(r, 300));

    expect(ticks().length).toBeGreaterThan(ticksAtPause);
  });

  it('cleans up tickers on module destroy (no leaked intervals)', async () => {
    await projector.project(buildMidBoltHistory());
    await new Promise((r) => setTimeout(r, 100));
    expect(tickService.getActiveTickerCount()).toBe(1);

    tickService.onModuleDestroy();
    expect(tickService.getActiveTickerCount()).toBe(0);

    // Wait through cycles that would-have-fired — no new ticks should arrive
    const finalCount = ticks().length;
    await new Promise((r) => setTimeout(r, 300));
    expect(ticks().length).toBe(finalCount);
  });
});
