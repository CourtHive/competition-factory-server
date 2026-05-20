import { validatePolicyForSave } from './policy-validator';

const validBase = {
  policyType: 'rankingPoints',
  name: 'USTA_JUNIOR_2026',
  version: '1.0.0',
  visibility: 'PROVIDER_PRIVATE',
  definition: { awardProfiles: [{ profileName: 'main' }] },
};

describe('validatePolicyForSave', () => {
  it('accepts a valid rankingPoints input', () => {
    expect(validatePolicyForSave(validBase)).toEqual({ ok: true });
  });

  it('rejects an empty awardProfiles array for rankingPoints', () => {
    const result = validatePolicyForSave({ ...validBase, definition: { awardProfiles: [] } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe('definition.awardProfiles');
    }
  });

  it('rejects a missing definition', () => {
    const result = validatePolicyForSave({ ...validBase, definition: undefined });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid visibility', () => {
    const result = validatePolicyForSave({ ...validBase, visibility: 'PUBLIC' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'visibility')).toBe(true);
    }
  });

  it('rejects a non-semver version', () => {
    const result = validatePolicyForSave({ ...validBase, version: 'v1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'version')).toBe(true);
    }
  });

  it('accepts date-style versions (2026.01) and short semver (1.0)', () => {
    expect(validatePolicyForSave({ ...validBase, version: '2026.01' }).ok).toBe(true);
    expect(validatePolicyForSave({ ...validBase, version: '1.0' }).ok).toBe(true);
    expect(validatePolicyForSave({ ...validBase, version: '2026.01.05' }).ok).toBe(true);
    expect(validatePolicyForSave({ ...validBase, version: '1.0.0-beta.1' }).ok).toBe(true);
  });

  it('rejects a name with disallowed characters', () => {
    const result = validatePolicyForSave({ ...validBase, name: 'usta junior' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'name')).toBe(true);
    }
  });

  it('accepts a non-rankingPoints policyType without checking awardProfiles', () => {
    const result = validatePolicyForSave({
      ...validBase,
      policyType: 'scoring',
      definition: { rules: { something: true } },
    });
    expect(result.ok).toBe(true);
  });
});
