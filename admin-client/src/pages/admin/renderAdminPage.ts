import { ensureSettingsStyles } from 'pages/tournament/tabs/settingsTab/renderSettingsTab';
import { getActiveProvider, clearActiveProvider } from 'services/provider/providerState';
import { getLoginState } from 'services/authentication/loginState';
import { removeAllChildNodes } from 'services/dom/transformers';
import { showTMXadmin } from 'services/transitions/screenSlaver';
import { renderAdminGrid } from 'pages/tournament/tabs/settingsTab/adminGrid';
import { context } from 'services/context';
import { t } from 'i18n';

import { SUPER_ADMIN, TMX_ADMIN } from 'constants/tmxConstants';

export function renderAdminPage(): void {
  showTMXadmin();

  const providerButton = document.getElementById('provider');
  const state = getLoginState();
  const provider = getActiveProvider();
  const isSuperAdmin = state?.roles?.includes(SUPER_ADMIN);

  // Provider branding click: if impersonating, go back to system; otherwise no-op
  if (providerButton) {
    if (isSuperAdmin && provider) {
      providerButton.onclick = () => {
        clearActiveProvider();
        context.router?.navigate('/system');
      };
      providerButton.style.cursor = 'pointer';
      providerButton.title = t('admin.backToSystem');
    } else {
      providerButton.onclick = null;
      providerButton.style.cursor = 'default';
      providerButton.title = '';
    }
  }

  const container = document.getElementById(TMX_ADMIN);
  if (!container) return;

  removeAllChildNodes(container);
  ensureSettingsStyles();
  renderAdminGrid(container, { provider, isSuperAdmin });
}
