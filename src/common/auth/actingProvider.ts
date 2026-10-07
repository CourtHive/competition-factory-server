/**
 * THE PROVIDER A SESSION ACTS FOR (Mentat/planning/MULTI_PROVIDER_CONTEXT_COMPLETION.md).
 *
 * CA, 2026-10-06: a user associated with more than one provider is never placed in one automatically; they
 * choose at login, and the session's `providerId` claim is that choice. To work for another provider they
 * switch, which issues a new session.
 */

export const PROVIDER_SELECTION_PURPOSE = 'provider-selection';
/** Not `admin`: every admin route, in every service that checks `aud`, refuses a selection token. */
export const PROVIDER_SELECTION_AUDIENCE = 'provider-selection';
export const PROVIDER_SELECTION_TTL = '10m';

export function resolveActingProviderId({
  provisionerProviderIds,
  legacyProviderId,
  associatedIds,
  isSuperAdmin,
  requested,
}: {
  /** Providers the user's provisioners manage: a provisioner may act for these too. */
  provisionerProviderIds: string[];
  /** `users.provider_id`, the pre-association "home" column. */
  legacyProviderId?: string;
  associatedIds: string[];
  isSuperAdmin: boolean;
  /** An explicit choice: select-provider, or a refreshed session that made one. */
  requested?: string;
}): string | undefined {
  if (requested) {
    const allowed = isSuperAdmin || associatedIds.includes(requested) || provisionerProviderIds.includes(requested);
    return allowed ? requested : undefined;
  }
  if (associatedIds.length === 1) return associatedIds[0];
  // no association rows: the legacy home column, as before associations existed
  if (associatedIds.length === 0) return legacyProviderId;
  // more than one, and no choice made: a super-admin keeps their home; anyone else acts for NONE until they choose
  return isSuperAdmin ? legacyProviderId : undefined;
}
