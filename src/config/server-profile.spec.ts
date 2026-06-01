import { getServerProfile, isModuleEnabled } from './server-profile';

// Per architectural-standards.md A6: prefer `jest.replaceProperty` over
// manual snapshot+restore — auto-restored on test teardown even if the
// test body throws.

describe('server-profile', () => {
  function withServerProfile(value: string | undefined): void {
    const next = { ...process.env };
    if (value === undefined) delete next.SERVER_PROFILE;
    else next.SERVER_PROFILE = value;
    jest.replaceProperty(process, 'env', next);
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
