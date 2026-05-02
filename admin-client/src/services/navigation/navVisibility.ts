/**
 * Top-bar nav icon visibility — driven by login role + (for the
 * provisioner icon) whether the user has actively selected a
 * provisioner via the provisioner workspace.
 *
 * The router calls `updateNavVisibility()` on every navigation; the
 * provisioner-state setters in `provisionerWorkspaceApi.ts` also call
 * it so the icon flips immediately when the user picks or clears
 * their active provisioner.
 */
import { getLoginState } from 'services/authentication/loginState';
import { getActiveProvisionerId } from 'services/apis/provisionerWorkspaceApi';
import { getActiveProvider } from 'services/provider/providerState';
import { NONE, PROVISIONER, SUPER_ADMIN } from 'constants/tmxConstants';

export function updateNavVisibility(): void {
  const state = getLoginState();
  const isSuperAdmin = !!state?.roles?.includes(SUPER_ADMIN);
  const isProvisioner = !!state?.roles?.includes(PROVISIONER);
  const hasActiveProvisioner = !!getActiveProvisionerId();
  const hasActiveProvider = !!getActiveProvider();

  setIconDisplay('h-system', isSuperAdmin);
  setIconDisplay('h-sync', isSuperAdmin);

  // Provisioner icon: PROVISIONER users always see it (their JWT carries
  // the provisioner context so the API works without an explicit pick).
  // SUPER_ADMIN sees it only after picking a provisioner — without the
  // X-Provisioner-Id header the /provisioner/* endpoints reject the
  // request, so showing the icon would just lead to an error toast.
  setIconDisplay('h-provisioner', isProvisioner || (isSuperAdmin && hasActiveProvisioner));

  // Templates icon: per-provider catalog requires an active provider.
  // PROVIDER_ADMIN users have one by default; super-admins must impersonate.
  setIconDisplay('h-templates', hasActiveProvider);

  // Policies icon: same per-provider scoping rule as Templates.
  setIconDisplay('h-policies', hasActiveProvider);
}

function setIconDisplay(id: string, visible: boolean): void {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : NONE;
}

let listenersWired = false;

/**
 * Listen for provisioner-state changes from
 * `provisionerWorkspaceApi.setActiveProvisionerId / clearActiveProvisionerId`
 * and refresh the icon when they fire. Call once during admin-client
 * bootstrap.
 */
export function wireNavVisibilityListeners(): void {
  if (listenersWired || typeof document === 'undefined') return;
  listenersWired = true;
  document.addEventListener('admin:provisioner-changed', () => updateNavVisibility());
}
