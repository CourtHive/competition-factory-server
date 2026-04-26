import { renderSanctioningDashboard } from 'pages/sanctioning/renderSanctioningDashboard';
import { renderSanctioningWizard } from 'pages/sanctioning/renderSanctioningWizard';
import { renderSanctioningDetail } from 'pages/sanctioning/renderSanctioningDetail';
import { renderProvisionerPage } from 'pages/provisioner/renderProvisionerPage';
import { renderSystemPage } from 'pages/system/renderSystemPage';
import { renderAdminPage } from 'pages/admin/renderAdminPage';
import { renderSyncPage } from 'pages/sync/renderSyncPage';
import { getLoginState } from 'services/authentication/loginState';
import { context } from 'services/context';
import Navigo from 'navigo';

import {
  SUPER_ADMIN,
  PROVISIONER,
  SYSTEM,
  PROVISIONER_ROUTE,
  SANCTIONING,
  SYNC,
  NONE,
} from 'constants/tmxConstants';

export function routeAdmin(): void {
  const router = new Navigo('/', { hash: true });
  context.router = router;

  // Wire homenav icon clicks
  const systemIcon = document.getElementById('h-system');
  const adminIcon = document.getElementById('h-admin');
  const provisionerIcon = document.getElementById('h-provisioner');
  const sanctioningIcon = document.getElementById('h-sanctioning');
  const syncIcon = document.getElementById('h-sync');
  if (systemIcon) systemIcon.addEventListener('click', () => router.navigate(`/${SYSTEM}`));
  if (adminIcon) adminIcon.addEventListener('click', () => router.navigate('/admin'));
  if (provisionerIcon) provisionerIcon.addEventListener('click', () => router.navigate(`/${PROVISIONER_ROUTE}`));
  if (sanctioningIcon) sanctioningIcon.addEventListener('click', () => router.navigate(`/${SANCTIONING}`));
  if (syncIcon) syncIcon.addEventListener('click', () => router.navigate(`/${SYNC}`));

  router.hooks({
    before(done) {
      updateNavVisibility();
      done();
    },
  });

  router.on(`/${SYSTEM}/:selectedTab`, (match) => {
    const state = getLoginState();
    if (!state?.roles?.includes(SUPER_ADMIN)) {
      router.navigate('/admin');
      return;
    }
    renderSystemPage(match?.data?.selectedTab);
  });

  router.on(`/${SYSTEM}`, () => {
    const state = getLoginState();
    if (!state?.roles?.includes(SUPER_ADMIN)) {
      router.navigate('/admin');
      return;
    }
    renderSystemPage();
  });

  router.on('/admin', () => {
    renderAdminPage();
  });

  // Provisioner workspace (PROVISIONER role + super-admin oversight)
  router.on(`/${PROVISIONER_ROUTE}/:selectedTab`, (match) => {
    const state = getLoginState();
    if (!isProvisionerOrSuperAdmin(state)) {
      router.navigate('/admin');
      return;
    }
    renderProvisionerPage(match?.data?.selectedTab);
  });

  router.on(`/${PROVISIONER_ROUTE}`, () => {
    const state = getLoginState();
    if (!isProvisionerOrSuperAdmin(state)) {
      router.navigate('/admin');
      return;
    }
    renderProvisionerPage();
  });

  // Sanctioning routes
  router.on(`/${SANCTIONING}/new`, () => {
    renderSanctioningWizard();
  });

  router.on(`/${SANCTIONING}/:sanctioningId`, (match) => {
    renderSanctioningDetail(match?.data?.sanctioningId);
  });

  router.on(`/${SANCTIONING}`, () => {
    renderSanctioningDashboard();
  });

  // Tournament Sync route (superadmin only)
  router.on(`/${SYNC}`, () => {
    const state = getLoginState();
    if (!state?.roles?.includes(SUPER_ADMIN)) {
      router.navigate('/admin');
      return;
    }
    renderSyncPage();
  });

  router.on('/', () => {
    const state = getLoginState();
    if (state?.roles?.includes(SUPER_ADMIN)) {
      router.navigate(`/${SYSTEM}`);
    } else if (state?.roles?.includes(PROVISIONER)) {
      router.navigate(`/${PROVISIONER_ROUTE}`);
    } else {
      router.navigate('/admin');
    }
  });

  router.notFound(() => {
    router.navigate('/');
  });

  router.resolve();
}

function isProvisionerOrSuperAdmin(state: any): boolean {
  return !!(state?.roles?.includes(SUPER_ADMIN) || state?.roles?.includes(PROVISIONER));
}

function updateNavVisibility(): void {
  const state = getLoginState();
  const isSuperAdmin = state?.roles?.includes(SUPER_ADMIN);
  const isProvisioner = state?.roles?.includes(PROVISIONER);

  const systemIcon = document.getElementById('h-system');
  if (systemIcon) {
    systemIcon.style.display = isSuperAdmin ? '' : NONE;
  }
  const hSync = document.getElementById('h-sync');
  if (hSync) {
    hSync.style.display = isSuperAdmin ? '' : NONE;
  }
  const provisionerIcon = document.getElementById('h-provisioner');
  if (provisionerIcon) {
    provisionerIcon.style.display = isSuperAdmin || isProvisioner ? '' : NONE;
  }
}
