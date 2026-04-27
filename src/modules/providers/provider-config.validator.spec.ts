import { validateCaps, validateSettings } from './provider-config.validator';

describe('validateCaps', () => {
  it('accepts an empty object', () => {
    expect(validateCaps({})).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(validateCaps(null)).toEqual([
      { path: '', code: 'wrongType', message: 'caps must be an object' },
    ]);
    expect(validateCaps('hi')).toHaveLength(1);
    expect(validateCaps([])[0].code).toBe('wrongType');
  });

  it('rejects unknown top-level keys', () => {
    const issues = validateCaps({ defaults: { defaultEventType: 'SINGLES' } });
    expect(issues).toEqual([
      {
        path: 'defaults',
        code: 'unknownField',
        message: expect.stringContaining('unknown caps top-level key'),
      },
    ]);
  });

  it('accepts well-formed branding', () => {
    expect(
      validateCaps({
        branding: {
          appName: 'IONSport',
          navbarLogoUrl: 'https://x/y.png',
          navbarLogoHeight: 32,
          accentColor: '#0066cc',
        },
      }),
    ).toEqual([]);
  });

  it('rejects unknown branding keys', () => {
    const issues = validateCaps({ branding: { foo: 'bar' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      path: 'branding.foo',
      code: 'unknownField',
      message: 'unknown branding key "foo"',
    });
  });

  it('rejects wrong-typed branding values', () => {
    const issues = validateCaps({ branding: { appName: 99, navbarLogoHeight: '32' } });
    expect(issues.find((i) => i.path === 'branding.appName')?.code).toBe('wrongType');
    expect(issues.find((i) => i.path === 'branding.navbarLogoHeight')?.code).toBe('wrongType');
  });

  it('accepts well-formed permissions (booleans + arrays)', () => {
    expect(
      validateCaps({
        permissions: {
          canCreateEvents: true,
          canDeleteEvents: false,
          allowedDrawTypes: ['SE', 'RR'],
          allowedScoringApproaches: [],
        },
      }),
    ).toEqual([]);
  });

  it('rejects unknown permission keys', () => {
    const issues = validateCaps({ permissions: { canFly: true } });
    expect(issues).toEqual([
      { path: 'permissions.canFly', code: 'unknownField', message: 'unknown permission key "canFly"' },
    ]);
  });

  it('rejects wrong-typed boolean permission', () => {
    const issues = validateCaps({ permissions: { canCreateEvents: 'yes' } });
    expect(issues[0]).toEqual({
      path: 'permissions.canCreateEvents',
      code: 'wrongType',
      message: 'canCreateEvents must be a boolean',
    });
  });

  it('rejects wrong-typed array permission', () => {
    const issues = validateCaps({ permissions: { allowedDrawTypes: 'SE' } });
    expect(issues[0]).toEqual({
      path: 'permissions.allowedDrawTypes',
      code: 'wrongType',
      message: 'allowedDrawTypes must be an array of strings',
    });
  });

  it('rejects array with non-string elements', () => {
    const issues = validateCaps({ permissions: { allowedDrawTypes: ['SE', 99] } });
    expect(issues[0].code).toBe('wrongType');
  });

  it('accepts well-formed policies', () => {
    expect(
      validateCaps({
        policies: {
          allowedMatchUpFormats: ['SET3-S:6/TB7'],
          allowedCategories: [{ ageCategoryCode: 'U12', categoryName: 'Under 12' }],
        },
      }),
    ).toEqual([]);
  });

  it('rejects unknown caps policy key', () => {
    // schedulingPolicy belongs to settings, not caps
    const issues = validateCaps({ policies: { schedulingPolicy: { startTime: '09:00' } } });
    expect(issues[0].code).toBe('unknownField');
    expect(issues[0].path).toBe('policies.schedulingPolicy');
  });

  it('rejects malformed allowedCategories', () => {
    const issues = validateCaps({ policies: { allowedCategories: [{ noCode: true }] } });
    expect(issues[0].code).toBe('wrongType');
  });

  it('accepts well-formed integrations', () => {
    expect(validateCaps({ integrations: { ssoProvider: 'ioncourt' } })).toEqual([]);
  });

  it('rejects unknown integrations keys', () => {
    const issues = validateCaps({ integrations: { customField: 'x' } });
    expect(issues[0].code).toBe('unknownField');
  });
});

describe('validateSettings', () => {
  describe('structural checks', () => {
    it('accepts an empty object', () => {
      expect(validateSettings({})).toEqual([]);
    });

    it('rejects non-objects', () => {
      expect(validateSettings(null)[0].code).toBe('wrongType');
    });

    it('rejects branding (settings has no branding)', () => {
      const issues = validateSettings({ branding: { appName: 'X' } });
      expect(issues[0].code).toBe('unknownField');
      expect(issues[0].path).toBe('branding');
    });

    it('rejects integrations (settings has no integrations)', () => {
      const issues = validateSettings({ integrations: { ssoProvider: 'foo' } });
      expect(issues[0].code).toBe('unknownField');
    });

    it('accepts well-formed defaults', () => {
      expect(
        validateSettings({
          defaults: { defaultEventType: 'SINGLES', defaultDrawType: 'SE' },
        }),
      ).toEqual([]);
    });

    it('rejects unknown defaults key', () => {
      const issues = validateSettings({ defaults: { defaultColor: 'blue' } });
      expect(issues[0].code).toBe('unknownField');
    });

    it('rejects wrong-typed defaults', () => {
      const issues = validateSettings({ defaults: { defaultEventType: 99 } });
      expect(issues[0].code).toBe('wrongType');
    });

    it('accepts settings-only policy keys', () => {
      expect(
        validateSettings({
          policies: {
            schedulingPolicy: { startTime: '09:00' },
            scoringPolicy: { variant: 'standard' },
            seedingPolicy: { method: 'random' },
          },
        }),
      ).toEqual([]);
    });
  });

  describe('caps-respect — boolean permissions', () => {
    it('accepts settings true when caps undefined', () => {
      expect(validateSettings({ permissions: { canCreateEvents: true } }, {})).toEqual([]);
    });

    it('accepts settings false when caps true (provider may disable)', () => {
      expect(
        validateSettings(
          { permissions: { canCreateEvents: false } },
          { permissions: { canCreateEvents: true } },
        ),
      ).toEqual([]);
    });

    it('accepts settings false when caps false (consistent)', () => {
      expect(
        validateSettings(
          { permissions: { canCreateEvents: false } },
          { permissions: { canCreateEvents: false } },
        ),
      ).toEqual([]);
    });

    it('REJECTS settings true when caps false (cannot upgrade above ceiling)', () => {
      const issues = validateSettings(
        { permissions: { canCreateOfficials: true } },
        { permissions: { canCreateOfficials: false } },
      );
      expect(issues).toEqual([
        {
          path: 'permissions.canCreateOfficials',
          code: 'exceedsCap',
          message: expect.stringContaining('cannot be enabled'),
        },
      ]);
    });

    it('accepts settings true when caps true', () => {
      expect(
        validateSettings(
          { permissions: { canCreateOfficials: true } },
          { permissions: { canCreateOfficials: true } },
        ),
      ).toEqual([]);
    });
  });

  describe('caps-respect — array permissions', () => {
    it('accepts any settings when caps universe undefined', () => {
      expect(
        validateSettings({ permissions: { allowedDrawTypes: ['SE', 'COMPASS'] } }, {}),
      ).toEqual([]);
    });

    it('accepts any settings when caps universe is empty (= unrestricted)', () => {
      expect(
        validateSettings(
          { permissions: { allowedDrawTypes: ['COMPASS'] } },
          { permissions: { allowedDrawTypes: [] } },
        ),
      ).toEqual([]);
    });

    it('accepts narrowing within caps universe', () => {
      expect(
        validateSettings(
          { permissions: { allowedDrawTypes: ['SE'] } },
          { permissions: { allowedDrawTypes: ['SE', 'RR', 'PAGE'] } },
        ),
      ).toEqual([]);
    });

    it('REJECTS settings adding values outside caps universe', () => {
      const issues = validateSettings(
        { permissions: { allowedDrawTypes: ['SE', 'COMPASS'] } },
        { permissions: { allowedDrawTypes: ['SE', 'RR'] } },
      );
      expect(issues).toEqual([
        {
          path: 'permissions.allowedDrawTypes',
          code: 'exceedsCap',
          message: expect.stringContaining('outside the provisioner-allowed universe'),
          disallowedValues: ['COMPASS'],
        },
      ]);
    });

    it('reports all disallowed values, not just the first', () => {
      const issues = validateSettings(
        { permissions: { allowedDrawTypes: ['SE', 'COMPASS', 'EVIL'] } },
        { permissions: { allowedDrawTypes: ['SE'] } },
      );
      expect(issues[0].disallowedValues).toEqual(['COMPASS', 'EVIL']);
    });
  });

  describe('caps-respect — policies', () => {
    it('accepts allowedMatchUpFormats narrowing', () => {
      expect(
        validateSettings(
          { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7'] } },
          { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7', 'SET5-S:6/TB7'] } },
        ),
      ).toEqual([]);
    });

    it('REJECTS allowedMatchUpFormats adding values outside caps universe', () => {
      const issues = validateSettings(
        { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7', 'SET99-S:6/TB99'] } },
        { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7'] } },
      );
      expect(issues[0].disallowedValues).toEqual(['SET99-S:6/TB99']);
    });

    it('REJECTS allowedCategories adding categories outside caps universe (by ageCategoryCode)', () => {
      const issues = validateSettings(
        { policies: { allowedCategories: [{ ageCategoryCode: 'U12' }, { ageCategoryCode: 'U99' }] } },
        { policies: { allowedCategories: [{ ageCategoryCode: 'U12' }, { ageCategoryCode: 'U14' }] } },
      );
      expect(issues[0].code).toBe('exceedsCap');
      expect(issues[0].disallowedValues).toEqual(['U99']);
    });

    it('accepts settings-only policy keys regardless of caps', () => {
      expect(
        validateSettings(
          { policies: { schedulingPolicy: { startTime: '09:00' } } },
          { policies: { allowedMatchUpFormats: ['SET3-S:6/TB7'] } },
        ),
      ).toEqual([]);
    });
  });

  describe('combined real-world rejection', () => {
    it('reports multiple issues from a single bad write', () => {
      const issues = validateSettings(
        {
          permissions: {
            canCreateOfficials: true, // caps forbid
            allowedDrawTypes: ['SE', 'COMPASS'], // COMPASS not in caps
            unknownPerm: true, // unknown key
          },
          defaults: { defaultEventType: 99 }, // wrong type
          branding: { appName: 'leak' }, // settings has no branding
        },
        {
          permissions: {
            canCreateOfficials: false,
            allowedDrawTypes: ['SE', 'RR'],
          },
        },
      );

      const codes = issues.map((i) => i.code).sort();
      expect(codes).toContain('exceedsCap');
      expect(codes).toContain('unknownField');
      expect(codes).toContain('wrongType');
      expect(issues.length).toBeGreaterThanOrEqual(4);
    });
  });
});
