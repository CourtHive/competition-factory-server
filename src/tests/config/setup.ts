// Jest globalSetup — runs once before the whole suite.
//
// Preflight: `courthive-ingest` is a `link:../courthive-ingest` dependency that
// the server consumes from its `build/` output (build/index.js). During a
// concurrent local rebuild that output can be momentarily inconsistent — e.g.
// index.js emitted but build/core/* not yet — which otherwise surfaces as a
// cryptic per-suite "Cannot find module './core/AdapterRegistry'" load failure.
// Fail fast here with an actionable message instead. CI builds courthive-ingest
// before the server, so this only trips during concurrent local dev builds.
module.exports = async function setup() {
  try {
    await import('courthive-ingest');
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        `[test setup] Could not load the 'courthive-ingest' build (${err.message}).\n` +
          `It is a link:../courthive-ingest dependency served from its build/ output, ` +
          `which is stale or mid-rebuild.\n` +
          `Rebuild it, then re-run:  (cd ../courthive-ingest && pnpm build)`,
      );
    }
    throw err;
  }
};
