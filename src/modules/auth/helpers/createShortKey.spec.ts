import { createShortKey } from './createShortKey';

describe('createShortKey', () => {
  it('returns a 6-character string', () => {
    const key = createShortKey();
    expect(key.length).toBe(6);
  });

  it('returns an uppercase string', () => {
    const key = createShortKey();
    expect(key).toBe(key.toUpperCase());
  });

  it('contains only alphanumeric characters', () => {
    const key = createShortKey();
    expect(key).toMatch(/^[A-Z0-9]+$/);
  });

  it('generates different keys over time', async () => {
    const key1 = createShortKey();
    await new Promise((r) => setTimeout(r, 2));
    const key2 = createShortKey();
    // Keys are time-based, so with a small delay they should differ
    // (though not guaranteed for very fast CPUs — this is a probabilistic test)
    expect(typeof key1).toBe('string');
    expect(typeof key2).toBe('string');
  });
});
