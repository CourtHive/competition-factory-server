/**
 * Silence Nest `Logger` output during test runs.
 *
 * Many services log expected errors on their error-path tests — ECONNREFUSED
 * webhook retries, HTTP 500 projector dispatches, "not found" mutations,
 * intentional migration rollbacks, etc. Those failures are asserted on via
 * mocks/spies, so the logger output is pure noise in an otherwise-passing
 * suite (117 suites emitted ~180 red/yellow lines).
 *
 * Setting the global log levels to an empty set suppresses ALL output while
 * leaving `Logger.prototype` methods callable — so the specs that
 * `jest.spyOn(Logger.prototype, …)` still observe their calls; only the write
 * to stdout/stderr is skipped (isLevelEnabled short-circuits). To see logs
 * while debugging a single spec, comment this file out of `setupFiles`.
 *
 * Registered via jest `setupFiles` in package.json (runs once per test file).
 */
import { Logger } from '@nestjs/common';

Logger.overrideLogger([]);
