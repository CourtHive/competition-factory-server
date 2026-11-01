import { governors } from 'tods-competition-factory';

/**
 * The factory's test-data methods (`mocksGovernor`) never run through `executionQueue` on a live record.
 *
 * The mutation engine imports every governor, mocksGovernor included, so without this a payload naming one of its
 * methods would run against the stored tournament: `anonymizeTournamentRecord` rewrites the record it is given in
 * place, and `modifyTournamentRecord` or `generateEventWithDraw` write generated data into it. The server's own mock
 * generation calls `governors.mocksGovernor` directly and is not affected.
 *
 * `ALLOW_TEST_DATA_METHODS=true` lets a development host run them (TMX's dev helper sends `completeDrawMatchUps` to
 * fill a draw with generated results). Read per call, as `DRAW_INTEGRITY_MODE` is.
 */
const TEST_DATA_METHODS = new Set(Object.keys(governors.mocksGovernor ?? {}));

export function testDataMethodsAllowed(): boolean {
  return process.env.ALLOW_TEST_DATA_METHODS?.trim().toLowerCase() === 'true';
}

/** The names in `methods` that are test-data methods, unless the host allows them. */
export function refusedTestDataMethods(methods: any[]): string[] {
  if (testDataMethodsAllowed()) return [];
  return [
    ...new Set((methods ?? []).map((item: any) => item?.method).filter((method: any) => TEST_DATA_METHODS.has(method))),
  ];
}
