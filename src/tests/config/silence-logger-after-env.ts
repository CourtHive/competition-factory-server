/**
 * Re-assert the Nest `Logger` silence before every test.
 *
 * `silence-logger.ts` (jest `setupFiles`) silences the logger once per test
 * file, which covers module-import-time logging. But some `.e2e.spec.ts` files
 * call `createNestApplication()`, which can reinstall the default logger with
 * its normal levels. Re-applying the override in a global `beforeEach` keeps
 * subsequent tests quiet without each spec having to opt in.
 *
 * Registered via jest `setupFilesAfterEnv` in package.json.
 */
import { Logger } from '@nestjs/common';

beforeEach(() => {
  Logger.overrideLogger([]);
});
