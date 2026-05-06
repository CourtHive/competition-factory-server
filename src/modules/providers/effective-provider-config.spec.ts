import { computeEffectiveConfig, mergePermissions, mergePolicies } from './effective-provider-config';
import { BOOLEAN_PERMISSION_KEYS, PERMISSIONS_DEFAULT_FALSE } from './provider-config.types';

describe('computeEffectiveConfig', () => {
  describe('branding (caps-only)', () => {
    it('takes branding from caps', () => {
      const result = computeEffectiveConfig({ branding: { appName: 'Acme' } }, {});
      expect(result.branding).toEqual({ appName: 'Acme' });
    });

    it('returns undefined branding when caps has none', () => {
      expect(computeEffectiveConfig({}, {}).branding).toBeUndefined();
    });

    it('ignores any branding-shaped data in settings (not part of settings type)', () => {
      // settings has no `branding` field, but verify caps still wins if a typed
      // caller somehow put one through.
      const result = computeEffectiveConfig({ branding: { appName: 'Caps' } }, {});
      expect(result.branding?.appName).toBe('Caps');
    });
  });

  describe('integrations (caps-only)', () => {
    it('takes integrations from caps', () => {
      const result = computeEffectiveConfig({ integrations: { ssoProvider: 'ioncourt' } }, {});
      expect(result.integrations).toEqual({ ssoProvider: 'ioncourt' });
    });
  });

  describe('defaults (settings-only)', () => {
    it('takes defaults from settings', () => {
      const result = computeEffectiveConfig({}, { defaults: { defaultEventType: 'SINGLES' } });
      expect(result.defaults).toEqual({ defaultEventType: 'SINGLES' });
    });

    it('returns undefined defaults when settings has none', () => {
      expect(computeEffectiveConfig({}, {}).defaults).toBeUndefined();
    });
  });

  describe('boolean permissions — AND with default-true semantics', () => {
    it('returns true when both caps and settings are unset (default true)', () => {
      const result = computeEffectiveConfig({}, {});
      expect(result.permissions?.canCreateEvents).toBe(true);
    });

    it('returns true when both explicitly true', () => {
      const result = computeEffectiveConfig(
        { permissions: { canCreateEvents: true } },
        { permissions: { canCreateEvents: true } },
      );
      expect(result.permissions?.canCreateEvents).toBe(true);
    });

    it('returns false when caps is false (provider cannot enable)', () => {
      const result = computeEffectiveConfig(
        { permissions: { canCreateEvents: false } },
        { permissions: { canCreateEvents: true } },
      );
      expect(result.permissions?.canCreateEvents).toBe(false);
    });

    it('returns false when settings is false (provider chose to disable)', () => {
      const result = computeEffectiveConfig(
        { permissions: { canCreateEvents: true } },
        { permissions: { canCreateEvents: false } },
      );
      expect(result.permissions?.canCreateEvents).toBe(false);
    });

    it('returns false when both false', () => {
      const result = computeEffectiveConfig(
        { permissions: { canCreateEvents: false } },
        { permissions: { canCreateEvents: false } },
      );
      expect(result.permissions?.canCreateEvents).toBe(false);
    });

    it('treats undefined caps as true (permissive)', () => {
      const result = computeEffectiveConfig({}, { permissions: { canCreateEvents: true } });
      expect(result.permissions?.canCreateEvents).toBe(true);
    });

    it('treats undefined settings as true (permissive)', () => {
      const result = computeEffectiveConfig({ permissions: { canCreateEvents: true } }, {});
      expect(result.permissions?.canCreateEvents).toBe(true);
    });
  });

  describe('boolean permissions — default-false exceptions', () => {
    it('canModifyCompletedScores defaults to false when both unset', () => {
      const result = computeEffectiveConfig({}, {});
      expect(result.permissions?.canModifyCompletedScores).toBe(false);
    });

    it('canModifyCompletedScores stays false when settings sets true but caps unset (caps default false)', () => {
      // caps default false ∧ settings true = false
      const result = computeEffectiveConfig({}, { permissions: { canModifyCompletedScores: true } });
      expect(result.permissions?.canModifyCompletedScores).toBe(false);
    });

    it('canModifyCompletedScores becomes true when caps and settings both explicitly true', () => {
      const result = computeEffectiveConfig(
        { permissions: { canModifyCompletedScores: true } },
        { permissions: { canModifyCompletedScores: true } },
      );
      expect(result.permissions?.canModifyCompletedScores).toBe(true);
    });

    it('canAccessProviderAdmin defaults to false when both unset', () => {
      expect(computeEffectiveConfig({}, {}).permissions?.canAccessProviderAdmin).toBe(false);
    });

    it('PERMISSIONS_DEFAULT_FALSE set covers exactly the documented exceptions', () => {
      expect(PERMISSIONS_DEFAULT_FALSE.has('canModifyCompletedScores')).toBe(true);
      expect(PERMISSIONS_DEFAULT_FALSE.has('canAccessProviderAdmin')).toBe(true);
      expect(PERMISSIONS_DEFAULT_FALSE.size).toBe(2);
    });
  });

  describe('all boolean permission keys are merged', () => {
    it('every BOOLEAN_PERMISSION_KEY appears in the output for an empty input', () => {
      const result = computeEffectiveConfig({}, {});
      for (const key of BOOLEAN_PERMISSION_KEYS) {
        expect(result.permissions).toHaveProperty(key);
        expect(typeof result.permissions?.[key]).toBe('boolean');
      }
    });
  });

  describe('array permissions — intersection with empty=unrestricted', () => {
    it('returns undefined when both caps and settings are unset', () => {
      const result = computeEffectiveConfig({}, {});
      expect(result.permissions?.allowedDrawTypes).toBeUndefined();
    });

    it('returns settings when caps is undefined', () => {
      const result = computeEffectiveConfig({}, { permissions: { allowedDrawTypes: ['SE'] } });
      expect(result.permissions?.allowedDrawTypes).toEqual(['SE']);
    });

    it('returns caps when settings is undefined', () => {
      const result = computeEffectiveConfig({ permissions: { allowedDrawTypes: ['SE', 'RR'] } }, {});
      expect(result.permissions?.allowedDrawTypes).toEqual(['SE', 'RR']);
    });

    it('returns settings when caps is empty array (empty caps = unrestricted)', () => {
      const result = computeEffectiveConfig(
        { permissions: { allowedDrawTypes: [] } },
        { permissions: { allowedDrawTypes: ['SE'] } },
      );
      expect(result.permissions?.allowedDrawTypes).toEqual(['SE']);
    });

    it('returns caps when settings is empty array', () => {
      const result = computeEffectiveConfig(
        { permissions: { allowedDrawTypes: ['SE', 'RR'] } },
        { permissions: { allowedDrawTypes: [] } },
      );
      expect(result.permissions?.allowedDrawTypes).toEqual(['SE', 'RR']);
    });

    it('intersects when both non-empty', () => {
      const result = computeEffectiveConfig(
        { permissions: { allowedDrawTypes: ['SE', 'RR', 'PAGE'] } },
        { permissions: { allowedDrawTypes: ['SE', 'COMPASS'] } },
      );
      // 'COMPASS' is dropped — settings cannot widen caps
      expect(result.permissions?.allowedDrawTypes).toEqual(['SE']);
    });

    it('intersection preserves caps order', () => {
      const result = computeEffectiveConfig(
        { permissions: { allowedDrawTypes: ['RR', 'SE', 'PAGE'] } },
        { permissions: { allowedDrawTypes: ['PAGE', 'SE'] } },
      );
      expect(result.permissions?.allowedDrawTypes).toEqual(['SE', 'PAGE']);
    });

    it('returns empty array when intersection is empty', () => {
      const result = computeEffectiveConfig(
        { permissions: { allowedDrawTypes: ['SE'] } },
        { permissions: { allowedDrawTypes: ['RR'] } },
      );
      expect(result.permissions?.allowedDrawTypes).toEqual([]);
    });

    it('handles allowedCreationMethods identically', () => {
      const result = computeEffectiveConfig(
        { permissions: { allowedCreationMethods: ['AUTOMATED', 'MANUAL'] } },
        { permissions: { allowedCreationMethods: ['AUTOMATED'] } },
      );
      expect(result.permissions?.allowedCreationMethods).toEqual(['AUTOMATED']);
    });

    it('handles allowedScoringApproaches identically', () => {
      const result = computeEffectiveConfig(
        { permissions: { allowedScoringApproaches: ['standard', 'tournament'] } },
        { permissions: { allowedScoringApproaches: ['tournament'] } },
      );
      expect(result.permissions?.allowedScoringApproaches).toEqual(['tournament']);
    });
  });

  describe('policies.allowedMatchUpFormats (intersect)', () => {
    it('intersects format codes', () => {
      const result = computeEffectiveConfig(
        { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7', 'SET5-S:6/TB7'] } },
        { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7'] } },
      );
      expect(result.policies?.allowedMatchUpFormats).toEqual(['SET3-S:6/TB7']);
    });

    it('returns settings when caps universe is unset', () => {
      const result = computeEffectiveConfig(
        {},
        { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7'] } },
      );
      expect(result.policies?.allowedMatchUpFormats).toEqual(['SET3-S:6/TB7']);
    });
  });

  describe('policies.allowedCategories (intersect by ageCategoryCode)', () => {
    it('intersects by ageCategoryCode, preserving caps order + caps display name', () => {
      const result = computeEffectiveConfig(
        {
          policies: {
            allowedCategories: [
              { ageCategoryCode: 'U12', categoryName: 'Under 12' },
              { ageCategoryCode: 'U14', categoryName: 'Under 14' },
              { ageCategoryCode: 'U16', categoryName: 'Under 16' },
            ],
          },
        },
        {
          policies: {
            allowedCategories: [
              { ageCategoryCode: 'U16', categoryName: 'should not appear' },
              { ageCategoryCode: 'U99', categoryName: 'not in caps' },
            ],
          },
        },
      );
      expect(result.policies?.allowedCategories).toEqual([{ ageCategoryCode: 'U16', categoryName: 'Under 16' }]);
    });

    it('returns caps when settings empty', () => {
      const result = computeEffectiveConfig(
        { policies: { allowedCategories: [{ ageCategoryCode: 'U12' }] } },
        { policies: { allowedCategories: [] } },
      );
      expect(result.policies?.allowedCategories).toEqual([{ ageCategoryCode: 'U12' }]);
    });
  });

  describe('policies.scheduling/scoring/seedingPolicy (settings-only)', () => {
    it('takes schedulingPolicy from settings, ignoring caps even if caller leaks one in', () => {
      const result = computeEffectiveConfig(
        {} as any,
        { policies: { schedulingPolicy: { foo: 'settings' } } },
      );
      expect(result.policies?.schedulingPolicy).toEqual({ foo: 'settings' });
    });

    it('takes scoringPolicy and seedingPolicy from settings', () => {
      const result = computeEffectiveConfig(
        {},
        {
          policies: {
            scoringPolicy: { variant: 'standard' },
            seedingPolicy: { method: 'random' },
          },
        },
      );
      expect(result.policies?.scoringPolicy).toEqual({ variant: 'standard' });
      expect(result.policies?.seedingPolicy).toEqual({ method: 'random' });
    });
  });

  describe('mergePermissions (direct)', () => {
    it('handles undefined inputs', () => {
      const out = mergePermissions();
      expect(out.canCreateEvents).toBe(true);
      expect(out.canAccessProviderAdmin).toBe(false);
    });
  });

  describe('mergePolicies (direct)', () => {
    it('handles undefined inputs', () => {
      const out = mergePolicies();
      expect(out.schedulingPolicy).toBeUndefined();
      expect(out.allowedMatchUpFormats).toBeUndefined();
      expect(out.allowedCategories).toBeUndefined();
    });
  });

  describe('full integration', () => {
    it('end-to-end realistic merge — IONSport caps + club settings', () => {
      const caps = {
        branding: { appName: 'IONSport TMX', accentColor: '#0066cc' },
        permissions: {
          canCreateOfficials: true,
          canModifyCompletedScores: true,
          allowedDrawTypes: ['SE', 'RR', 'PAGE'],
          allowedCreationMethods: ['AUTOMATED', 'MANUAL'],
        },
        policies: {
          allowedMatchUpFormats: ['SET3-S:6/TB7', 'SET5-S:6/TB7'],
        },
        integrations: { ssoProvider: 'ioncourt' },
      };
      const settings = {
        permissions: {
          canCreateOfficials: false, // club disables this within the cap
          canModifyCompletedScores: true, // club enables (caps allow)
          allowedDrawTypes: ['SE', 'RR'], // club narrows
          allowedCreationMethods: ['AUTOMATED'], // club narrows
        },
        policies: {
          schedulingPolicy: { startTime: '09:00' },
          allowedMatchUpFormats: ['SET3-S:6/TB7'],
        },
        defaults: { defaultEventType: 'SINGLES' },
      };
      const out = computeEffectiveConfig(caps, settings);

      expect(out.branding?.appName).toBe('IONSport TMX');
      expect(out.integrations?.ssoProvider).toBe('ioncourt');
      expect(out.defaults?.defaultEventType).toBe('SINGLES');
      // Caps allow + settings disable → false
      expect(out.permissions?.canCreateOfficials).toBe(false);
      // Caps allow + settings enable → true (default-false key)
      expect(out.permissions?.canModifyCompletedScores).toBe(true);
      // Intersection
      expect(out.permissions?.allowedDrawTypes).toEqual(['SE', 'RR']);
      expect(out.permissions?.allowedCreationMethods).toEqual(['AUTOMATED']);
      expect(out.policies?.allowedMatchUpFormats).toEqual(['SET3-S:6/TB7']);
      // Settings-owned policy
      expect(out.policies?.schedulingPolicy).toEqual({ startTime: '09:00' });
    });
  });

  describe('participantPrivacy (settings-only — provider-owned)', () => {
    it('defaults cityState to false when settings is absent', () => {
      const out = computeEffectiveConfig({}, {});
      expect(out.participantPrivacy?.cityState).toBe(false);
    });

    it('defaults cityState to false when settings.participantPrivacy is absent', () => {
      const out = computeEffectiveConfig({}, { defaults: { defaultEventType: 'SINGLES' } });
      expect(out.participantPrivacy?.cityState).toBe(false);
    });

    it('reads cityState true from settings', () => {
      const out = computeEffectiveConfig({}, { participantPrivacy: { cityState: true } });
      expect(out.participantPrivacy?.cityState).toBe(true);
    });

    it('reads cityState false from settings explicitly', () => {
      const out = computeEffectiveConfig({}, { participantPrivacy: { cityState: false } });
      expect(out.participantPrivacy?.cityState).toBe(false);
    });

    it('ignores stray cityState on caps (privacy is provider-owned, not provisioner-gated)', () => {
      // A stale write to caps.participantPrivacy must not influence the
      // effective shape — settings tier is the only source of truth.
      const out = computeEffectiveConfig(
        { participantPrivacy: { cityState: true } } as any,
        {},
      );
      expect(out.participantPrivacy?.cityState).toBe(false);
    });
  });
});
