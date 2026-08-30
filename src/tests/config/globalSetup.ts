/**
 * Vitest globalSetup entry — runs once for the whole suite.
 *
 * Vitest expects `setup`/`teardown` named exports from a single module, where jest took
 * two separate `globalSetup` / `globalTeardown` paths. The bodies are unchanged; they
 * live in their original files.
 */
export { default as setup } from './setup';
export { default as teardown } from './teardown';
