import { isUuid, validateCapability, validateScope, validateWindow } from './grantValidation';

describe('validateCapability', () => {
  it('accepts a permission key and the wildcard', () => {
    expect(validateCapability('canEnterScores')).toBeNull();
    expect(validateCapability('*')).toBeNull();
  });

  it('rejects a role name, which is a preset rather than a capability', () => {
    expect(validateCapability('RECORDER')).toMatch(/unknown capability/);
  });

  it('rejects a near-miss key rather than storing a grant that authorizes nothing', () => {
    expect(validateCapability('canEnterScore')).toMatch(/unknown capability/);
  });

  it('rejects a missing or non-string capability', () => {
    expect(validateCapability(undefined)).toBe('capability is required');
    expect(validateCapability('   ')).toBe('capability is required');
    expect(validateCapability(7)).toBe('capability is required');
  });
});

describe('validateScope', () => {
  it('accepts an omitted scope and a tournament-wide one', () => {
    expect(validateScope(undefined)).toBeNull();
    expect(validateScope({})).toBeNull();
  });

  it('accepts the filterMatchUps vocabulary', () => {
    expect(validateScope({ courtIds: ['c7'], scheduledDates: ['2026-08-29'] })).toBeNull();
  });

  // The gate refuses an unevaluable scope forever, so storing one is storing a
  // grant that can never be honoured.
  it('rejects an unrecognized key and names it', () => {
    const error = validateScope({ courtId: ['c7'] });
    expect(error).toContain('"courtId"');
    expect(error).toContain('courtIds');
  });

  it('names every unrecognized key, not just the first', () => {
    const error = validateScope({ playerIds: ['p1'], roundNumbers: ['1'] });
    expect(error).toContain('"playerIds"');
    expect(error).toContain('"roundNumbers"');
  });

  // isTargetInScope skips an empty list, so this reads as a restriction and
  // behaves as none.
  it('rejects an empty permitted-value list', () => {
    expect(validateScope({ courtIds: [] })).toMatch(/constrains nothing/);
  });

  it('rejects non-array and non-string members', () => {
    expect(validateScope({ courtIds: 'c7' })).toBe('scope.courtIds must be an array of ids');
    expect(validateScope({ courtIds: [7] })).toMatch(/non-empty id strings/);
    expect(validateScope({ courtIds: [''] })).toMatch(/non-empty id strings/);
  });

  it('rejects a scope that is not an object', () => {
    expect(validateScope([])).toBe('scope must be an object');
    expect(validateScope('courtIds')).toBe('scope must be an object');
  });
});

describe('validateWindow', () => {
  const now = new Date('2026-08-24T12:00:00Z');

  it('accepts an absent window and a future one', () => {
    expect(validateWindow(undefined, undefined, now)).toBeNull();
    expect(validateWindow('2026-08-29T08:00:00Z', '2026-08-29T18:00:00Z', now)).toBeNull();
  });

  it('rejects an unparseable instant on either end', () => {
    expect(validateWindow('saturday', undefined, now)).toBe('notBefore is not a valid date');
    expect(validateWindow(undefined, 'saturday', now)).toBe('notAfter is not a valid date');
  });

  it('rejects a window that ends before it starts', () => {
    expect(validateWindow('2026-08-29T18:00:00Z', '2026-08-29T08:00:00Z', now)).toBe(
      'notAfter must be later than notBefore',
    );
  });

  // A shift that has already ended is the operator error this check exists for.
  it('rejects a window that has already closed', () => {
    expect(validateWindow(undefined, '2026-08-23T18:00:00Z', now)).toMatch(/already in the past/);
  });

  it('accepts a Date instance as well as an ISO string', () => {
    expect(validateWindow(new Date('2026-08-29T08:00:00Z'), new Date('2026-08-29T18:00:00Z'), now)).toBeNull();
  });
});

describe('isUuid', () => {
  it('accepts a uuid and rejects anything the driver would choke on', () => {
    expect(isUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("' OR 1=1 --")).toBe(false);
  });
});
