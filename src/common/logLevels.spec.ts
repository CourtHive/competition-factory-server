import { LOG_LEVELS } from './logLevels';

describe('LOG_LEVELS', () => {
  it('includes log — the level every Logger.log startup report is written at', () => {
    expect(LOG_LEVELS).toContain('log');
  });

  it('writes every level Nest defines, so no level is dropped by omission again', () => {
    const nestLevels = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
    expect([...LOG_LEVELS].sort((a, b) => a.localeCompare(b))).toEqual(nestLevels.sort((a, b) => a.localeCompare(b)));
  });
});
