import { getCalendar } from 'services/apis/servicesApi';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { destroyTable } from 'pages/tournament/destroyTable';
import { context } from 'services/context';
import { t } from 'i18n';

import type { ProviderValue } from 'types/tmx';

const CALENDAR_TABLE = 'adminCalendarTable';

type AdminGridParams = {
  provider?: ProviderValue;
  isSuperAdmin?: boolean;
};

export function renderAdminGrid(container: HTMLElement, params?: AdminGridParams): void {
  const { provider, isSuperAdmin } = params || {};

  const grid = document.createElement('div');
  grid.className = 'settings-grid';

  if (provider) {
    renderProviderInfoPanel(grid, provider, isSuperAdmin);
    renderCalendarPanel(grid, provider);
    renderPolicyPanel(grid);
    renderQuickActionsPanel(grid, isSuperAdmin);
  } else {
    renderNoProviderPanel(grid, isSuperAdmin);
  }

  container.appendChild(grid);
}

function renderProviderInfoPanel(grid: HTMLElement, provider: ProviderValue, isSuperAdmin?: boolean): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-blue';
  panel.style.gridColumn = '1 / 3';

  const image = provider.onlineResources?.find(
    (r) => r.name === 'providerImage' && r.resourceType === 'URL' && r.resourceSubType === 'IMAGE',
  );

  panel.innerHTML = `
    <h3><i class="fa-solid fa-building"></i> ${provider.organisationName || 'Provider'}</h3>
    <div style="display: flex; gap: 16px; align-items: flex-start;">
      ${image?.identifier ? `<img src="${image.identifier}" alt="Provider logo" style="max-width: 120px; max-height: 80px; border-radius: 4px;" />` : ''}
      <div>
        <div style="margin-bottom: 4px;"><strong>${t('admin.abbreviation')}:</strong> ${provider.organisationAbbreviation || '—'}</div>
        <div style="margin-bottom: 4px; font-size: 0.8rem; color: var(--tmx-text-muted);">${t('admin.providerId')}: ${provider.organisationId}</div>
        ${isSuperAdmin ? `<div style="margin-top: 8px; font-size: 0.8rem; color: var(--tmx-accent-blue);"><i class="fa-solid fa-eye"></i> ${t('admin.impersonating')}</div>` : ''}
      </div>
    </div>
  `;

  grid.appendChild(panel);
}

function renderCalendarPanel(grid: HTMLElement, provider: ProviderValue): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-green';
  panel.style.gridColumn = '3 / 5';

  const header = document.createElement('h3');
  header.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${t('admin.tournaments')}`;
  panel.appendChild(header);

  const tableEl = document.createElement('div');
  tableEl.id = CALENDAR_TABLE;
  panel.appendChild(tableEl);

  grid.appendChild(panel);

  if (!provider.organisationAbbreviation) return;

  getCalendar({ providerAbbr: provider.organisationAbbreviation }).then(
    (res: any) => {
      const entries = res?.data?.calendar || [];

      destroyTable({ anchorId: CALENDAR_TABLE });

      new Tabulator(tableEl, {
        placeholder: t('admin.noTournaments'),
        layout: 'fitColumns',
        maxHeight: 300,
        data: entries.map((e: any) => ({
          tournamentName: e.tournament?.tournamentName || '',
          startDate: e.tournament?.startDate || '',
          endDate: e.tournament?.endDate || '',
          tournamentId: e.tournamentId,
        })),
        columns: [
          { title: t('admin.tournamentName'), field: 'tournamentName', headerSort: true },
          { title: t('admin.startDate'), field: 'startDate', headerSort: true, width: 120 },
          { title: t('admin.endDate'), field: 'endDate', headerSort: true, width: 120 },
        ],
      });
    },
    () => {
      tableEl.innerHTML = `<div style="color: var(--tmx-text-muted); font-style: italic; padding: 12px;">${t('admin.calendarLoadError')}</div>`;
    },
  );
}

function renderPolicyPanel(grid: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-red';
  panel.style.gridColumn = '1 / 3';
  panel.innerHTML = `
    <h3><i class="fa-solid fa-shield-halved"></i> ${t('admin.policyDefinitions')}</h3>
    <p style="color: var(--tmx-text-secondary); font-size: 0.9rem;">${t('admin.policyEditorComingSoon')}</p>
  `;
  grid.appendChild(panel);
}

function renderQuickActionsPanel(grid: HTMLElement, isSuperAdmin?: boolean): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-purple';
  panel.style.gridColumn = '3 / 5';

  const actions: string[] = [];
  if (isSuperAdmin) {
    actions.push(`<div class="quick-action" id="qa-system-providers"><i class="fa-solid fa-server"></i> ${t('admin.manageProviders')}</div>`);
    actions.push(`<div class="quick-action" id="qa-system-users"><i class="fa-solid fa-users"></i> ${t('admin.manageUsers')}</div>`);
  }
  actions.push(`<div class="quick-action" id="qa-back-system"><i class="fa-solid fa-arrow-left"></i> ${t('admin.backToSystem')}</div>`);

  panel.innerHTML = `
    <h3><i class="fa-solid fa-bolt"></i> ${t('admin.quickActions')}</h3>
    <div class="quick-actions-list">${actions.join('')}</div>
  `;

  grid.appendChild(panel);

  // Wire click handlers after appending to DOM
  setTimeout(() => {
    document.getElementById('qa-system-providers')?.addEventListener('click', () => context.router?.navigate('/system/providers'));
    document.getElementById('qa-system-users')?.addEventListener('click', () => context.router?.navigate('/system/users'));
    document.getElementById('qa-back-system')?.addEventListener('click', () => context.router?.navigate('/system'));
  }, 0);
}

function renderNoProviderPanel(grid: HTMLElement, isSuperAdmin?: boolean): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-indigo';
  panel.style.gridColumn = '1 / -1';

  if (isSuperAdmin) {
    panel.innerHTML = `
      <h3><i class="fa-solid fa-info-circle"></i> ${t('admin.noProviderSelected')}</h3>
      <p style="color: var(--tmx-text-secondary); font-size: 0.9rem;">${t('admin.selectProviderHint')}</p>
    `;
  } else {
    panel.innerHTML = `
      <h3><i class="fa-solid fa-shield-halved"></i> ${t('admin.dashboard')}</h3>
      <p style="color: var(--tmx-text-secondary); font-size: 0.9rem;">${t('admin.providerDashboardComingSoon')}</p>
    `;
  }

  grid.appendChild(panel);
}
