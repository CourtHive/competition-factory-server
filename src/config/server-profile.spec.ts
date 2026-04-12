import { getServerProfile, isModuleEnabled } from './server-profile';

describe('server-profile', () => {
  const originalEnv = process.env.SERVER_PROFILE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SERVER_PROFILE;
    } else {
      process.env.SERVER_PROFILE = originalEnv;
    }
  });

  describe('getServerProfile', () => {
    it('defaults to full when not set', () => {
      delete process.env.SERVER_PROFILE;
      expect(getServerProfile()).toBe('full');
    });

    it('returns tournament when set', () => {
      process.env.SERVER_PROFILE = 'tournament';
      expect(getServerProfile()).toBe('tournament');
    });

    it('returns provider when set', () => {
      process.env.SERVER_PROFILE = 'provider';
      expect(getServerProfile()).toBe('provider');
    });

    it('returns full for invalid values', () => {
      process.env.SERVER_PROFILE = 'invalid';
      expect(getServerProfile()).toBe('full');
    });
  });

  describe('isModuleEnabled', () => {
    it('enables all modules for full profile', () => {
      process.env.SERVER_PROFILE = 'full';
      expect(isModuleEnabled('tournament')).toBe(true);
      expect(isModuleEnabled('provider')).toBe(true);
    });

    it('enables only tournament modules for tournament profile', () => {
      process.env.SERVER_PROFILE = 'tournament';
      expect(isModuleEnabled('tournament')).toBe(true);
      expect(isModuleEnabled('provider')).toBe(false);
    });

    it('enables only provider modules for provider profile', () => {
      process.env.SERVER_PROFILE = 'provider';
      expect(isModuleEnabled('tournament')).toBe(false);
      expect(isModuleEnabled('provider')).toBe(true);
    });
  });
});
