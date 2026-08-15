import { RelayConfig, isFederationConfigured, resolveInstanceRole } from './relay.config';

describe('RelayConfig', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  // The default INVERTED on 2026-08-15 (was 'local'). `local` is the rarer,
  // more privileged deployment and must now be opted into — see
  // `resolveInstanceRole` for the fail-open this closes.
  it('defaults role to cloud when INSTANCE_ROLE is unset', () => {
    delete process.env.INSTANCE_ROLE;
    expect(new RelayConfig().role).toBe('cloud');
  });

  it('resolves an unrecognised role to cloud rather than local', () => {
    // Fail-closed: a typo ('Local ', 'site', '') must not silently grant the
    // instance local-side behaviour.
    for (const value of ['locl', 'site', 'LOCALHOST', '']) {
      process.env.INSTANCE_ROLE = value;
      expect(new RelayConfig().role).toBe('cloud');
    }
  });

  it('opts into local only on an explicit, case- and space-insensitive match', () => {
    for (const value of ['local', 'LOCAL', '  Local  ']) {
      process.env.INSTANCE_ROLE = value;
      expect(new RelayConfig().role).toBe('local');
    }
  });

  it('parses cloud role', () => {
    process.env.INSTANCE_ROLE = 'cloud';
    expect(new RelayConfig().role).toBe('cloud');
  });

  // Asserted directly, not only through `RelayConfig.role`: both module
  // `forRoot()` factories call the free function at module-construction time,
  // before DI exists, so that is the path production actually takes.
  it('resolveInstanceRole is the same decision the modules make', () => {
    delete process.env.INSTANCE_ROLE;
    expect(resolveInstanceRole()).toBe('cloud');

    process.env.INSTANCE_ROLE = 'local';
    expect(resolveInstanceRole()).toBe('local');
  });

  it('reports federation configured only when UPSTREAM_API_KEY is a non-blank value', () => {
    delete process.env.UPSTREAM_API_KEY;
    expect(isFederationConfigured()).toBe(false);

    process.env.UPSTREAM_API_KEY = '   ';
    expect(isFederationConfigured()).toBe(false);

    process.env.UPSTREAM_API_KEY = 'service-key';
    expect(isFederationConfigured()).toBe(true);
  });

  it('falls back to dev venue id', () => {
    delete process.env.LOCAL_VENUE_ID;
    expect(new RelayConfig().venueId).toBe('arena-dev-00');
  });

  it('returns undefined cloudRelayUrl when blank', () => {
    process.env.CLOUD_RELAY_URL = '   ';
    expect(new RelayConfig().cloudRelayUrl).toBeUndefined();
  });

  it('parses cloudRelayUrl when set', () => {
    process.env.CLOUD_RELAY_URL = 'https://relay.example.test';
    expect(new RelayConfig().cloudRelayUrl).toBe('https://relay.example.test');
  });

  it('parses numeric envs with sensible defaults', () => {
    delete process.env.CLOUD_RELAY_MAX_BATCH;
    delete process.env.CLOUD_RELAY_DRAIN_INTERVAL_MS;
    const config = new RelayConfig();
    expect(config.maxBatchSize).toBe(50);
    expect(config.drainIntervalMs).toBe(5000);

    process.env.CLOUD_RELAY_MAX_BATCH = '12';
    process.env.CLOUD_RELAY_DRAIN_INTERVAL_MS = '2500';
    expect(new RelayConfig().maxBatchSize).toBe(12);
    expect(new RelayConfig().drainIntervalMs).toBe(2500);
  });

  it('parses VENUE_API_KEYS into a map', () => {
    process.env.VENUE_API_KEYS = 'venue-1:abc123, venue-2:def456';
    const map = new RelayConfig().venueApiKeys;
    expect(map.get('venue-1')).toBe('abc123');
    expect(map.get('venue-2')).toBe('def456');
  });

  it('returns empty venue api keys map when env missing', () => {
    delete process.env.VENUE_API_KEYS;
    expect(new RelayConfig().venueApiKeys.size).toBe(0);
  });
});
