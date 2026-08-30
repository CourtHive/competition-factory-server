import { getServerProfile, isModuleEnabled } from './server-profile';

// Per architectural-standards.md A6, the point is auto-restore on teardown even
// when the test body throws. Vitest has no `replaceProperty`, and `restoreMocks`
// cannot stand in for it — this suite has spies that must survive across tests
// within a describe. An explicit afterEach keeps the same guarantee.

describe('server-profile', () => {
  const realEnv = process.env;
  afterEach(() => {
    process.env = realEnv;
  });

  function withServerProfile(value: string | undefined): void {
    const next = { ...process.env };
    if (value === undefined) delete next.SERVER_PROFILE;
    else next.SERVER_PROFILE = value;
    process.env = next;
  }

  describe('getServerProfile', () => {
    it('defaults to full when not set', () => {
      withServerProfile(undefined);
      expect(getServerProfile()).toBe('full');
    });

    it('returns tournament when set', () => {
      withServerProfile('tournament');
      expect(getServerProfile()).toBe('tournament');
    });

    it('returns provider when set', () => {
      withServerProfile('provider');
      expect(getServerProfile()).toBe('provider');
    });

    it('returns full for invalid values', () => {
      withServerProfile('invalid');
      expect(getServerProfile()).toBe('full');
    });
  });

  describe('isModuleEnabled', () => {
    it('enables all modules for full profile', () => {
      withServerProfile('full');
      expect(isModuleEnabled('tournament')).toBe(true);
      expect(isModuleEnabled('provider')).toBe(true);
    });

    it('enables only tournament modules for tournament profile', () => {
      withServerProfile('tournament');
      expect(isModuleEnabled('tournament')).toBe(true);
      expect(isModuleEnabled('provider')).toBe(false);
    });

    it('enables only provider modules for provider profile', () => {
      withServerProfile('provider');
      expect(isModuleEnabled('tournament')).toBe(false);
      expect(isModuleEnabled('provider')).toBe(true);
    });
  });
});
