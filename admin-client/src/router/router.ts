import { renderSanctioningDashboard } from 'pages/sanctioning/renderSanctioningDashboard';
import { renderSanctioningWizard } from 'pages/sanctioning/renderSanctioningWizard';
import { renderSanctioningDetail } from 'pages/sanctioning/renderSanctioningDetail';
import { renderSystemPage } from 'pages/system/renderSystemPage';
import { renderAdminPage } from 'pages/admin/renderAdminPage';
import { renderSyncPage } from 'pages/sync/renderSyncPage';
import { getLoginState } from 'services/authentication/loginState';
import { context } from 'services/context';
import Navigo from 'navigo';

import { SUPER_ADMIN, SYSTEM, SANCTIONING, SYNC, NONE } from 'constants/tmxConstants';

export function routeAdmin(): void {
  const router = new Navigo('/', { hash: true });
  context.router = router;

  // Wire homenav icon clicks
  const systemIcon = document.getElementById('h-system');
  const adminIcon = document.getElementById('h-admin');
  const sanctioningIcon = document.getElementById('h-sanctioning');
  const syncIcon = document.getElementById('h-sync');
  if (systemIcon) systemIcon.addEventListener('click', () => router.navigate(`/${SYSTEM}`));
  if (adminIcon) adminIcon.addEventListener('click', () => router.navigate('/admin'));
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
    } else {
      router.navigate('/admin');
    }
  });

  router.notFound(() => {
    router.navigate('/');
  });

  router.resolve();
}

function updateNavVisibility(): void {
  const state = getLoginState();
  const isSuperAdmin = state?.roles?.includes(SUPER_ADMIN);

  const systemIcon = document.getElementById('h-system');
  if (systemIcon) {
    systemIcon.style.display = isSuperAdmin ? '' : NONE;
  }
  const hSync = document.getElementById('h-sync');
  if (hSync) {
    hSync.style.display = isSuperAdmin ? '' : NONE;
  }
}
