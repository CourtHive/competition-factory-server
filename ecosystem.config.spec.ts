/**
 * Structural sanity test for ecosystem.config.js.
 *
 * PM2 silently ignores typos in app names or missing fields, and a bad
 * ecosystem file only surfaces at deploy time on nest. This test catches
 * regressions up front — e.g. a misspelled script path, a removed app,
 * or a missing env var needed by the Score Relay bundle.
 */

interface EcosystemApp {
  name: string;
  script: string;
  watch: boolean;
  args?: string;
  env?: Record<string, string>;
}

interface EcosystemConfig {
  apps: EcosystemApp[];
}

describe('ecosystem.config.js', () => {
  let config: EcosystemConfig;

  beforeAll(() => {
    // dotenv.config() runs at require time; clear the cache so the test
    // sees a fresh load with whatever env is in place.
    delete require.cache[require.resolve('./ecosystem.config.js')];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    config = require('./ecosystem.config.js') as EcosystemConfig;
  });

  it('exports a non-empty apps array', () => {
    expect(Array.isArray(config.apps)).toBe(true);
    expect(config.apps.length).toBeGreaterThan(0);
  });

  it('includes the core three apps (Factory Server, hive-db, Score Relay)', () => {
    const names = config.apps.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['Factory Server', 'hive-db', 'Score Relay']));
  });

  describe('Factory Server', () => {
    it('runs build/src/main.js', () => {
      const app = config.apps.find((a) => a.name === 'Factory Server');
      expect(app).toBeDefined();
      expect(app?.script).toBe('build/src/main.js');
      expect(app?.watch).toBe(false);
    });
  });

  describe('hive-db', () => {
    it('runs the net-level server with DB env vars', () => {
      const app = config.apps.find((a) => a.name === 'hive-db');
      expect(app).toBeDefined();
      expect(app?.script).toContain('net-level');
      expect(app?.env).toEqual(
        expect.objectContaining({
          DB_HOST: expect.any(String),
          DB_PORT: expect.any(String),
          DB_USER: expect.any(String),
          DB_PASS: expect.any(String),
        }),
      );
    });
  });

  describe('Score Relay', () => {
    let app: EcosystemApp | undefined;

    beforeAll(() => {
      app = config.apps.find((a) => a.name === 'Score Relay');
    });

    it('runs score-relay/dist/server.js from the release root', () => {
      expect(app).toBeDefined();
      expect(app?.script).toBe('score-relay/dist/server.js');
      expect(app?.watch).toBe(false);
    });

    it('exposes the env vars the score-relay server reads', () => {
      // These are the env keys that epixodic/score-relay/src/server.ts
      // reads at startup. If this list drifts, the relay will silently
      // use defaults in production — catch it here instead.
      const requiredKeys = [
        'RELAY_PORT',
        'CORS_ORIGIN',
        'STALE_MATCH_HOURS',
        'PRUNE_INTERVAL_MINUTES',
        'FACTORY_SERVER_URL',
        'PERSIST_SCORES',
        'PROJECTION_API_KEY',
        'VIDEO_BOARD_UDP_TARGET',
      ];
      for (const key of requiredKeys) {
        expect(app?.env).toHaveProperty(key);
      }
    });

    it('defaults RELAY_PORT to 8384 when unset', () => {
      expect(app?.env?.RELAY_PORT).toBe('8384');
    });

    it('defaults FACTORY_SERVER_URL to the local factory server', () => {
      expect(app?.env?.FACTORY_SERVER_URL).toBe('http://localhost:8383');
    });
  });
});
