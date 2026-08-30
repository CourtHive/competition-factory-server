import { isTournamentAccessScopingEnabled, __resetFeatureFlagWarnings } from './feature-flags';
import { Logger } from '@nestjs/common';

describe('isTournamentAccessScopingEnabled — fail-closed (A3)', () => {
  const original = process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;

  beforeEach(() => __resetFeatureFlagWarnings());
  afterAll(() => {
    if (original === undefined) delete process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
    else process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = original;
  });

  // The defect: this previously read `=== 'true'`, so a deploy that forgot the
  // variable silently disabled every tournament access check and made every
  // user behave as PROVIDER_ADMIN.
  it('defaults to ENABLED when the variable is unset', () => {
    delete process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
    expect(isTournamentAccessScopingEnabled()).toBe(true);
  });

  it('defaults to ENABLED when the variable is empty', () => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = '';
    expect(isTournamentAccessScopingEnabled()).toBe(true);
  });

  it('stays ENABLED for a typo rather than failing open', () => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'ture';
    expect(isTournamentAccessScopingEnabled()).toBe(true);
  });

  it('is disabled only by the explicit string "false"', () => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'false';
    expect(isTournamentAccessScopingEnabled()).toBe(false);
  });

  it('remains enabled when explicitly "true"', () => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
    expect(isTournamentAccessScopingEnabled()).toBe(true);
  });

  // A2: the fall-back must surface, not be silent.
  it('warns exactly once when the variable is unset', () => {
    delete process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    isTournamentAccessScopingEnabled();
    isTournamentAccessScopingEnabled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('ENABLE_TOURNAMENT_ACCESS_SCOPING');
    warn.mockRestore();
  });

  it('does not warn when the variable is set', () => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'false';
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    isTournamentAccessScopingEnabled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
