import { refusedTestDataMethods, testDataMethodsAllowed } from './testDataMethods';
import { afterEach, describe, expect, it } from 'vitest';

describe('test-data methods', () => {
  afterEach(() => {
    delete process.env.ALLOW_TEST_DATA_METHODS;
  });

  it('names every mocksGovernor method in a payload, once each', () => {
    const methods = [
      { method: 'anonymizeTournamentRecord', params: {} },
      { method: 'setMatchUpStatus', params: {} },
      { method: 'completeDrawMatchUps', params: {} },
      { method: 'anonymizeTournamentRecord', params: {} },
    ];
    expect(refusedTestDataMethods(methods)).toEqual(['anonymizeTournamentRecord', 'completeDrawMatchUps']);
  });

  it('passes a payload of ordinary methods', () => {
    expect(refusedTestDataMethods([{ method: 'addEvent' }, { method: 'setMatchUpStatus' }])).toEqual([]);
    expect(refusedTestDataMethods([])).toEqual([]);
  });

  it('lets a development host opt in', () => {
    process.env.ALLOW_TEST_DATA_METHODS = 'true';
    expect(testDataMethodsAllowed()).toBe(true);
    expect(refusedTestDataMethods([{ method: 'completeDrawMatchUps' }])).toEqual([]);

    process.env.ALLOW_TEST_DATA_METHODS = 'yes';
    expect(refusedTestDataMethods([{ method: 'completeDrawMatchUps' }])).toEqual(['completeDrawMatchUps']);
  });
});
