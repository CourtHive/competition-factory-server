/**
 * Disable HTTP rate limiting for the duration of a test run.
 *
 * The app applies `HttpThrottlerGuard` as a global `APP_GUARD`, and the auth controller
 * additionally pins login at `LOGIN_THROTTLE = { limit: 10, ttl: 60_000 }` — ten logins per
 * minute per IP, which is correct in production (it is the password-guessing brake) and
 * impossible for this suite to respect: fourteen supertest spec files each authenticate in
 * `beforeAll`, several log in per test, and every one of them arrives from 127.0.0.1. Jest
 * runs multiple spec files per worker, so a worker blows through ten logins inside one
 * 60-second window without doing anything unusual.
 *
 * The symptom was NOT a failing login. The eleventh login returns 429, so `token` comes back
 * undefined, and the failure surfaces later as an unrelated authenticated request asserting
 * `.expect(200)` — which is why it looked like a mystery flake in whichever spec happened to
 * be next. It reproduced only ~2 runs in 5 and never in isolation, because whether a worker
 * crosses the threshold depends on how spec files are distributed and how fast they run.
 *
 * Measured, not assumed: a probe firing repeated `POST /auth/login` against the real app got
 * `{"200": 10, "429": 1}` — the 429 landing on request #10, exactly the configured limit.
 *
 * `DISABLE_HTTP_THROTTLE` is the escape hatch the guard already documents for this case
 * ("intended ONLY for local dev / CI e2e … NEVER set in production"). Setting it here rather
 * than in a single npm script means `test`, `test:watch` and `test:cov` all get it, and CI
 * cannot drift from local by forgetting the variable.
 *
 * No spec asserts throttling behaviour, so nothing loses coverage from this. If one is ever
 * added, it must set the variable back to `false` for its own process rather than removing
 * this file.
 *
 * Registered via vitest `setupFiles` in vitest.config.mts (runs once per test file, before the app
 * module is imported).
 */
process.env.DISABLE_HTTP_THROTTLE = 'true';
