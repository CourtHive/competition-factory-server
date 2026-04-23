import { describe, it, expect, beforeEach } from 'vitest';
import { setActiveProvider, clearActiveProvider, getActiveProvider } from './providerState';
import { context } from 'services/context';

describe('providerState', () => {
  beforeEach(() => {
    context.provider = undefined;
    // Ensure DOM elements exist for updateProviderBranding
    if (!document.getElementById('provider')) {
      const el = document.createElement('div');
      el.id = 'provider';
      document.body.appendChild(el);
    }
  });

  describe('setActiveProvider', () => {
    it('sets the provider on context', () => {
      const provider = {
        organisationName: 'Test Org',
        organisationAbbreviation: 'TO',
        organisationId: 'org-1',
      };
      setActiveProvider(provider as any);
      expect(context.provider).toEqual(provider);
    });

    it('updates provider branding element', () => {
      setActiveProvider({
        organisationName: 'Tennis Australia',
        organisationAbbreviation: 'TA',
        organisationId: 'ta-1',
      } as any);
      const el = document.getElementById('provider');
      expect(el?.innerHTML).toContain('TA');
      expect(el?.title).toBe('Tennis Australia');
    });
  });

  describe('clearActiveProvider', () => {
    it('clears the provider from context', () => {
      context.provider = { organisationName: 'X', organisationAbbreviation: 'X', organisationId: 'x' } as any;
      clearActiveProvider();
      expect(context.provider).toBeUndefined();
    });

    it('resets branding to default', () => {
      setActiveProvider({ organisationName: 'A', organisationAbbreviation: 'A', organisationId: 'a' } as any);
      clearActiveProvider();
      const el = document.getElementById('provider');
      expect(el?.innerHTML).toContain('CMX');
    });
  });

  describe('getActiveProvider', () => {
    it('returns undefined when no provider is set', () => {
      expect(getActiveProvider()).toBeUndefined();
    });

    it('returns the active provider', () => {
      const provider = { organisationName: 'P', organisationAbbreviation: 'P', organisationId: 'p' };
      setActiveProvider(provider as any);
      expect(getActiveProvider()).toEqual(provider);
    });
  });
});
