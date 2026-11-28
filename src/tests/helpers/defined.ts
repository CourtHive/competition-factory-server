/**
 * The value a fixture is expected to have produced. Throws, failing the test, when it is null or undefined, so a
 * spec reads optional record fields without asserting them away.
 */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}
