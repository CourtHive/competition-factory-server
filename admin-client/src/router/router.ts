import { renderSanctioningDashboard } from 'pages/sanctioning/renderSanctioningDashboard';
import { renderSanctioningWizard } from 'pages/sanctioning/renderSanctioningWizard';
import { renderSanctioningDetail } from 'pages/sanctioning/renderSanctioningDetail';
import { renderSystemPage } from 'pages/system/renderSystemPage';
import { renderAdminPage } from 'pages/admin/renderAdminPage';
import { getLoginState } from 'services/authentication/loginState';
import { context } from 'services/context';
import Navigo from 'navigo';

import { SUPER_ADMIN, SYSTEM, SANCTIONING, NONE } from 'constants/tmxConstants';

export function routeAdmin(): void {
  const router = new Navigo('/', { hash: true });
  context.router = router;

  // Wire homenav icon clicks
  const systemIcon = document.getElementById('h-system');
  const adminIcon = document.getElementById('h-admin');
  const sanctioningIcon = document.getElementById('h-sanctioning');
  if (systemIcon) systemIcon.addEventListener('click', () => router.navigate(`/${SYSTEM}`));
  if (adminIcon) adminIcon.addEventListener('click', () => router.navigate('/admin'));
  if (sanctioningIcon) sanctioningIcon.addEventListener('click', () => router.navigate(`/${SANCTIONING}`));

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
}
