/**
 * Provisioner-role workspace (Phase 2A.5).
 *
 * Top-level page for users who represent a provisioner. Sub-tabs:
 *   - My Providers — list providers managed by this provisioner +
 *     create new providers (auto-tagged as 'owner' to the provisioner)
 *   - Users — list/create SSO users for managed providers
 */
import { renderProvisionerProvidersPanel } from './providersPanel';
import { renderProvisionerUsersPanel } from './usersPanel';
import { ensureSystemStyles } from 'pages/tournament/tabs/settingsTab/systemTab/systemTabStyles';
import { showTMXprovisioner } from 'services/transitions/screenSlaver';
import { removeAllChildNodes } from 'services/dom/transformers';
import { controlBar } from 'courthive-components';
import { context } from 'services/context';
import { t } from 'i18n';

import {
  LEFT,
  PROVIDERS_TAB,
  USERS_TAB,
  PROVISIONER_ROUTE,
  TMX_PROVISIONER,
} from 'constants/tmxConstants';

type SubTab = 'providers' | 'users';
let currentSubTab: SubTab = 'providers';

export function renderProvisionerPage(selectedTab?: string): void {
  showTMXprovisioner();

  if (selectedTab === PROVIDERS_TAB || selectedTab === USERS_TAB) {
    currentSubTab = selectedTab;
  } else {
    currentSubTab = PROVIDERS_TAB;
  }

  ensureSystemStyles();

  const container = document.getElementById(TMX_PROVISIONER);
  if (!container) return;
  removeAllChildNodes(container);

  const wrapper = document.createElement('div');
  wrapper.className = 'system-tab-container';

  const controlBarEl = document.createElement('div');
  wrapper.appendChild(controlBarEl);

  const contentEl = document.createElement('div');
  contentEl.style.flex = '1';
  contentEl.style.minHeight = '0';
  wrapper.appendChild(contentEl);

  container.appendChild(wrapper);

  const switchSubTab = (tab: SubTab) => {
    if (tab === currentSubTab) return;
    context.router?.navigate(`/${PROVISIONER_ROUTE}/${tab}`);
  };

  const buildControlBar = () => {
    removeAllChildNodes(controlBarEl);
    const tabs = [
      {
        active: currentSubTab === 'providers',
        onClick: () => switchSubTab('providers'),
        label: t('provisioner.myProviders'),
        close: true,
      },
      {
        active: currentSubTab === 'users',
        onClick: () => switchSubTab('users'),
        label: t('provisioner.users'),
        close: true,
      },
    ];
    const items: any[] = [{ id: 'provisionerSubTabs', location: LEFT, tabs }];
    controlBar({ target: controlBarEl, items });
  };

  const renderCurrentPanel = () => {
    removeAllChildNodes(contentEl);
    if (currentSubTab === 'providers') {
      renderProvisionerProvidersPanel({ container: contentEl });
    } else {
      renderProvisionerUsersPanel({ container: contentEl });
    }
  };

  buildControlBar();
  renderCurrentPanel();
}
