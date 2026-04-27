import { loadRuntimeConfig, getRuntimeConfig } from './runtimeConfig';
import { tmxToast } from './notifications/tmxToast';
import { t } from 'i18n';

const IMPERSONATED_PROVIDER_KEY = 'tmx_impersonated_provider';

export interface ImpersonateProviderValue {
  organisationId?: string;
  organisationName?: string;
  organisationAbbreviation?: string;
  [key: string]: any;
}

/**
 * Hand off an impersonated provider to TMX in a new browser tab.
 *
 * Writes the provider into the shared `tmx_impersonated_provider`
 * localStorage key (TMX reads this on load for super-admins / provisioner
 * reps and seeds `context.provider`), then opens TMX at /#/tournaments.
 *
 * The TMX URL comes from the server's `/api/config` endpoint so deployment
 * topology is configured once on the server, not embedded in the admin
 * build. If the runtime config hasn't loaded yet, this awaits it; if the
 * server is unreachable, the user gets a toast and we abort rather than
 * silently fall back to the current origin (which previously redirected
 * to the marketing site on prod).
 */
export async function openTmxImpersonate(provider: ImpersonateProviderValue): Promise<void> {
  try {
    globalThis.localStorage?.setItem(IMPERSONATED_PROVIDER_KEY, JSON.stringify(provider));
  } catch {
    // Non-fatal — TMX falls back to letting the user pick manually.
  }

  let config = getRuntimeConfig();
  if (!config) config = await loadRuntimeConfig();

  if (!config?.tmxUrl) {
    tmxToast({ message: t('system.tmxUrlMissing'), intent: 'is-danger' });
    return;
  }

  const base = config.tmxUrl.replace(/\/+$/, '');
  globalThis.open(`${base}/#/tournaments`, '_blank');
}
