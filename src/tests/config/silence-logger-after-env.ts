/**
 * Re-assert the Nest `Logger` silence before every test.
 *
 * `silence-logger.ts` (a vitest `setupFiles` entry) silences the logger once per test
 * file, which covers module-import-time logging. But some `.e2e.spec.ts` files
 * call `createNestApplication()`, which can reinstall the default logger with
 * its normal levels. Re-applying the override in a global `beforeEach` keeps
 * subsequent tests quiet without each spec having to opt in.
 *
 * Registered via vitest `setupFiles` in vitest.config.mts. Jest needed a separate
 * `setupFilesAfterEnv` list because its `setupFiles` run before the test framework is
 * installed and could not call beforeEach; vitest's setupFiles run inside the test
 * context, so both files sit in the one list.
 */
import { Logger } from '@nestjs/common';

beforeEach(() => {
  Logger.overrideLogger([]);
});
