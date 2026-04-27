import { baseApi } from './apis/baseApi';

export interface RuntimeConfig {
  /** URL where the TMX client is served — used for the Impersonate handoff. */
  tmxUrl: string;
}

let cached: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig | null> | null = null;

/**
 * Fetch runtime config from the server (`GET /api/config`) and cache it.
 * Subsequent calls return the cached value. Idempotent and safe to call
 * from multiple sites — concurrent first-call attempts share one request.
 *
 * Returns null only when the server is unreachable; callers must handle
 * that case rather than fall back to a baked-in URL (which is precisely
 * the bug we're fixing — a stale build-time fallback that pointed
 * impersonate links at the marketing site).
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await baseApi.get('/api/config');
      const data = res?.data;
      if (data?.tmxUrl) {
        cached = { tmxUrl: data.tmxUrl };
        return cached;
      }
      return null;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Synchronous access to the cached config. Returns null until loadRuntimeConfig() resolves. */
export function getRuntimeConfig(): RuntimeConfig | null {
  return cached;
}

/** Test helper — clears the cache so successive tests can stub fresh values. */
export function __resetRuntimeConfigForTests(): void {
  cached = null;
  inflight = null;
}
