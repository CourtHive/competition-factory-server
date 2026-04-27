import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { calendarAudit, getCalendar, getTournamentInfo } from 'services/apis/servicesApi';
import { openSettingsEditor } from 'components/providerConfig/openSettingsEditor';
import { manageTournamentAccess } from 'components/manageTournamentAccess';
import { destroyTable } from 'pages/tournament/destroyTable';
import { tmxToast } from 'services/notifications/tmxToast';
import { context } from 'services/context';
import { t } from 'i18n';

import type { ProviderValue } from 'types/tmx';

const CALENDAR_TABLE = 'adminCalendarTable';
const TOURNAMENT_DETAIL = 'adminTournamentDetail';

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
    renderQuickActionsPanel(grid, { provider, isSuperAdmin });
    renderCalendarPanel(grid, provider, isSuperAdmin);
    renderTournamentDetailPanel(grid);
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

function renderCalendarPanel(grid: HTMLElement, provider: ProviderValue, isSuperAdmin?: boolean): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-green';
  panel.style.gridColumn = '1 / 3';

  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';

  const header = document.createElement('h3');
  header.style.margin = '0';
  header.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${t('admin.tournaments')}`;
  headerRow.appendChild(header);

  if (isSuperAdmin) {
    const auditBtn = document.createElement('button');
    auditBtn.className = 'btn-audit';
    auditBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass-chart"></i> ${t('admin.runAudit')}`;
    auditBtn.addEventListener('click', () => runCalendarAudit(provider));
    headerRow.appendChild(auditBtn);
  }

  panel.appendChild(headerRow);

  const auditSummary = document.createElement('div');
  auditSummary.id = 'auditSummary';
  auditSummary.style.display = 'none';
  panel.appendChild(auditSummary);

  const tableEl = document.createElement('div');
  tableEl.id = CALENDAR_TABLE;
  panel.appendChild(tableEl);

  grid.appendChild(panel);

  if (!provider.organisationAbbreviation) return;

  getCalendar({ providerAbbr: provider.organisationAbbreviation }).then(
    (res: any) => {
      const raw = res?.data?.calendar;
      const entries = Array.isArray(raw) ? raw : [];
      buildCalendarTable(tableEl, entries);
    },
    () => {
      tableEl.innerHTML = `<div style="color: var(--tmx-text-muted); font-style: italic; padding: 12px;">${t('admin.calendarLoadError')}</div>`;
    },
  );
}

function buildCalendarTable(tableEl: HTMLElement, entries: any[], auditResults?: Map<string, boolean>): void {
  destroyTable({ anchorId: CALENDAR_TABLE });

  const data = entries.map((e: any) => ({
    tournamentName: e.tournament?.tournamentName || '',
    startDate: e.tournament?.startDate || '',
    endDate: e.tournament?.endDate || '',
    tournamentId: e.tournamentId,
    existsInStorage: auditResults ? auditResults.get(e.tournamentId) ?? true : true,
  }));

  const table = new Tabulator(tableEl, {
    placeholder: t('admin.noTournaments'),
    layout: 'fitColumns',
    selectable: 1,
    maxHeight: 300,
    data,
    columns: [
      { title: t('admin.tournamentName'), field: 'tournamentName', headerSort: true },
      { title: t('admin.startDate'), field: 'startDate', headerSort: true, width: 120 },
      { title: t('admin.endDate'), field: 'endDate', headerSort: true, width: 120 },
    ],
    rowFormatter: (row) => {
      if (!row.getData().existsInStorage) {
        row.getElement().classList.add('row-missing');
      }
    },
  });

  table.on('rowClick', (_e, row) => {
    const rowData = row.getData();
    if (!rowData.tournamentId) return;

    if (!rowData.existsInStorage) {
      showTournamentDetailMissing(rowData.tournamentName || rowData.tournamentId);
      return;
    }
    loadTournamentDetail(rowData.tournamentId);
  });
}

function runCalendarAudit(provider: ProviderValue): void {
  if (!provider.organisationAbbreviation) return;

  calendarAudit({ providerAbbr: provider.organisationAbbreviation }).then(
    (res: any) => {
      const { calendarEntries, counts } = res?.data || {};
      if (!calendarEntries) return;

      const auditResults = new Map<string, boolean>();
      for (const entry of calendarEntries) {
        auditResults.set(entry.tournamentId, entry.existsInStorage);
      }

      const summaryEl = document.getElementById('auditSummary');
      if (summaryEl) {
        summaryEl.style.display = 'block';
        const isClean = counts.missing === 0;
        summaryEl.className = isClean ? 'audit-summary audit-clean' : 'audit-summary audit-warning';
        summaryEl.innerHTML = isClean
          ? `<i class="fa-solid fa-circle-check"></i> ${t('admin.auditClean', { total: counts.total })}`
          : `<i class="fa-solid fa-triangle-exclamation"></i> ${t('admin.auditWarning', { total: counts.total, missing: counts.missing })}`;
      }

      const tableEl = document.getElementById(CALENDAR_TABLE);
      if (tableEl) {
        buildCalendarTable(tableEl, calendarEntries, auditResults);
      }
    },
    () => {
      tmxToast({ message: t('admin.auditError'), intent: 'is-danger' });
    },
  );
}

function renderTournamentDetailPanel(grid: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-indigo';
  panel.style.gridColumn = '3 / 5';
  panel.innerHTML = `
    <h3><i class="fa-solid fa-circle-info"></i> ${t('admin.tournamentDetail')}</h3>
    <div id="${TOURNAMENT_DETAIL}" class="tournament-detail-content">
      <p style="color: var(--tmx-text-muted); font-style: italic;">${t('admin.selectTournament')}</p>
    </div>
  `;
  grid.appendChild(panel);
}

function loadTournamentDetail(tournamentId: string): void {
  const detailEl = document.getElementById(TOURNAMENT_DETAIL);
  if (!detailEl) return;

  detailEl.innerHTML = `<p style="color: var(--tmx-text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> ${t('admin.loadingTournament')}</p>`;

  getTournamentInfo({ tournamentId }).then(
    (res: any) => {
      const info = res?.data?.tournamentInfo;
      if (!info) {
        detailEl.innerHTML = `<p style="color: var(--tmx-text-muted);">${t('admin.tournamentNotFound')}</p>`;
        return;
      }
      renderTournamentInfo(detailEl, info, tournamentId);
    },
    () => {
      detailEl.innerHTML = `<p style="color: var(--tmx-accent-red);">${t('admin.tournamentLoadError')}</p>`;
    },
  );
}

function showTournamentDetailMissing(name: string): void {
  const detailEl = document.getElementById(TOURNAMENT_DETAIL);
  if (!detailEl) return;

  detailEl.innerHTML = `
    <div style="color: var(--tmx-accent-red);">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <strong>${name}</strong><br/>
      <span style="font-size: 0.85rem;">${t('admin.tournamentMissingFromStorage')}</span>
    </div>
  `;
}

function renderTournamentInfo(container: HTMLElement, info: any, tournamentId: string): void {
  const events = info.eventInfo ?? [];
  const participantCount = info.individualParticipantCount ?? 0;
  const teamCount = info.teamParticipantCount ?? 0;
  const startDate = info.startDate ?? '';
  const endDate = info.endDate ?? '';
  const tournamentName = info.tournamentName ?? '';
  const matchUpStats = info.matchUpStats;
  const venues = info.venues ?? [];
  const providerId = info.parentOrganisation?.organisationId;

  const eventRows = events
    .map((e: any) => {
      const drawCount = e.drawDefinitionCount ?? 0;
      const entriesCount = e.entriesCount ?? 0;
      return `<tr>
        <td>${e.eventName || '—'}</td>
        <td>${e.eventType || '—'}</td>
        <td style="text-align: right;">${entriesCount}</td>
        <td style="text-align: right;">${drawCount}</td>
      </tr>`;
    })
    .join('');

  const venueList = venues.length
    ? venues.map((v: any) => `<span class="venue-tag">${v.venueName || '—'}</span>`).join(' ')
    : '<span style="color: var(--tmx-text-muted);">—</span>';

  const manageAccessButton = providerId
    ? `<button id="ti-manage-access" class="btn-invite" style="font-size: .75rem; padding: 4px 10px; margin-top: 8px;">
         <i class="fa-solid fa-shield"></i> ${t('manageAccess.title')}
       </button>`
    : '';

  container.innerHTML = `
    <div class="ti-header">${tournamentName}</div>
    <div class="ti-dates">${startDate} — ${endDate}</div>
    <div class="ti-stat"><strong>${t('admin.participants')}:</strong> ${participantCount}${teamCount ? ` (${teamCount} teams)` : ''}</div>
    ${matchUpStats ? `<div class="ti-stat"><strong>MatchUps:</strong> ${matchUpStats.completed}/${matchUpStats.total} completed (${matchUpStats.percentComplete}%)</div>` : ''}
    <div class="ti-stat"><strong>${t('admin.venues')}:</strong> ${venueList}</div>
    ${
      events.length
        ? `<table class="ti-table">
        <thead><tr>
          <th>${t('admin.event')}</th>
          <th>${t('admin.type')}</th>
          <th style="text-align: right;">${t('admin.entries')}</th>
          <th style="text-align: right;">${t('admin.draws')}</th>
        </tr></thead>
        <tbody>${eventRows}</tbody>
      </table>`
        : `<p style="color: var(--tmx-text-muted);">${t('admin.noEvents')}</p>`
    }
    ${manageAccessButton}
  `;

  if (providerId) {
    setTimeout(() => {
      document.getElementById('ti-manage-access')?.addEventListener('click', () => {
        manageTournamentAccess({
          tournamentId,
          tournamentName,
          providerId,
        });
      });
    }, 0);
  }
}

function renderQuickActionsPanel(
  grid: HTMLElement,
  params: { provider: ProviderValue; isSuperAdmin?: boolean },
): void {
  const { provider, isSuperAdmin } = params;
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-purple';
  panel.style.gridColumn = '3 / 5';

  const actions: string[] = isSuperAdmin
    ? [
        `<div class="quick-action" id="qa-system-providers"><i class="fa-solid fa-server"></i> ${t('admin.manageProviders')}</div>`,
        `<div class="quick-action" id="qa-system-users"><i class="fa-solid fa-users"></i> ${t('admin.manageUsers')}</div>`,
      ]
    : [];
  // Provider admin (or super-admin while impersonating) can edit settings
  // for the active provider. Server-side gate: PROVIDER_ADMIN of this
  // provider OR SUPER_ADMIN. The button is shown to anyone here; an
  // unauthorized user gets a clear ForbiddenException on save.
  actions.push(
    `<div class="quick-action" id="qa-edit-settings"><i class="fa-solid fa-sliders"></i> ${t('providerConfig.editSettingsButton')}</div>`,
  );
  actions.push(
    `<div class="quick-action" id="qa-back-system"><i class="fa-solid fa-arrow-left"></i> ${t('admin.backToSystem')}</div>`,
  );

  panel.innerHTML = `
    <h3><i class="fa-solid fa-bolt"></i> ${t('admin.quickActions')}</h3>
    <div class="quick-actions-list">${actions.join('')}</div>
  `;

  grid.appendChild(panel);

  setTimeout(() => {
    document
      .getElementById('qa-system-providers')
      ?.addEventListener('click', () => context.router?.navigate('/system/providers'));
    document
      .getElementById('qa-system-users')
      ?.addEventListener('click', () => context.router?.navigate('/system/users'));
    document.getElementById('qa-back-system')?.addEventListener('click', () => context.router?.navigate('/system'));
    document.getElementById('qa-edit-settings')?.addEventListener('click', () => {
      openSettingsEditor({
        providerId: provider.organisationId,
        providerName: provider.organisationName,
      });
    });
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
