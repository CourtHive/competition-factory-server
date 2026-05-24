/**
 * Whether a login state may use the admin console (`/admin`).
 *
 * "Real admins" only: super-admin, provisioner, a provider admin (PROVIDER_ADMIN
 * at any associated provider), or the deprecated global `admin` role (honored
 * until retired). Plain end-users (e.g. a DIRECTOR-only account) get the
 * no-access state instead of being silently dropped into the admin app.
 *
 * Takes the state as an argument (rather than calling getLoginState) so this
 * stays free of an import cycle with loginState.
 */
import { SUPER_ADMIN, PROVISIONER, ADMIN, PROVIDER_ADMIN } from 'constants/tmxConstants';

import type { LoginState } from 'types/tmx';

export function canAccessAdmin(state?: LoginState): boolean {
  if (!state) return false;
  const roles = state.roles ?? [];
  if (roles.includes(SUPER_ADMIN) || roles.includes(PROVISIONER) || roles.includes(ADMIN)) return true;
  return (state.providerAssociations ?? []).some((assoc) => assoc.providerRole === PROVIDER_ADMIN);
}
