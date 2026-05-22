import { createUniqueKey } from './createUniqueKey';

describe('createUniqueKey', () => {
  it('returns a hex string', () => {
    const key = createUniqueKey();
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('has default length of 32 chars (16 bytes)', () => {
    const key = createUniqueKey();
    expect(key.length).toBe(32);
  });

  it('respects custom byte length', () => {
    const key8 = createUniqueKey(8);
    expect(key8.length).toBe(16); // 8 bytes = 16 hex chars

    const key32 = createUniqueKey(32);
    expect(key32.length).toBe(64); // 32 bytes = 64 hex chars
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, () => createUniqueKey()));
    expect(keys.size).toBe(100);
  });
});
