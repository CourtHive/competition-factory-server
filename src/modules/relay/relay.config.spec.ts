import { RelayConfig } from './relay.config';

describe('RelayConfig', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('defaults role to local', () => {
    delete process.env.INSTANCE_ROLE;
    expect(new RelayConfig().role).toBe('local');
  });

  it('parses cloud role', () => {
    process.env.INSTANCE_ROLE = 'cloud';
    expect(new RelayConfig().role).toBe('cloud');
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
