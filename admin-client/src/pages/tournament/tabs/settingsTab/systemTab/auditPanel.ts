import { TabulatorFull as Tabulator } from 'tabulator-tables';

import { getDeletedDraws, restoreDeletedDraw, type DeletedDrawAuditRow } from 'services/apis/auditApi';
import { destroyTable } from 'pages/tournament/destroyTable';
import { confirmModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { getCalendar } from 'services/apis/servicesApi';
import { t } from 'i18n';

const TOURNAMENT_TABLE_ID = 'systemAuditTournamentTable';
const DRAW_TABLE_ID = 'systemAuditDrawTable';

interface ProviderRow {
  organisationName: string;
  organisationAbbreviation: string;
  organisationId: string;
}

interface CalendarTournament {
  tournamentId: string;
  tournamentName: string;
  startDate: string;
  endDate: string;
  searchText: string;
}

type RenderAuditPanelParams = {
  container: HTMLElement;
  providers: any[];
};

export function renderAuditPanel({ container, providers }: RenderAuditPanelParams): void {
  container.innerHTML = '';

  const providerRows = (providers || [])
    .map((p): ProviderRow => ({
      organisationName: p.value?.organisationName || '',
      organisationAbbreviation: p.value?.organisationAbbreviation || '',
      organisationId: p.value?.organisationId || p.key || '',
    }))
    .filter((p) => p.organisationAbbreviation)
    .sort((a, b) => a.organisationName.localeCompare(b.organisationName));

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'system-users-toolbar';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.gap = '12px';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight: 600; font-size: 0.95rem;';
  titleEl.textContent = t('system.audit.title');

  const controls = document.createElement('div');
  controls.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;';

  const providerSelect = document.createElement('select');
  providerSelect.className = 'btn-edit';
  providerSelect.style.minWidth = '180px';
  for (const p of providerRows) {
    const opt = document.createElement('option');
    opt.value = p.organisationAbbreviation;
    opt.textContent = p.organisationName;
    providerSelect.appendChild(opt);
  }

  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.placeholder = t('system.audit.tournamentFilterPlaceholder');
  filterInput.style.cssText = 'min-width: 220px; padding: 6px 10px; border: 1px solid var(--tmx-border-secondary, #ccc); border-radius: 4px;';

  controls.appendChild(providerSelect);
  controls.appendChild(filterInput);

  toolbar.appendChild(titleEl);
  toolbar.appendChild(controls);
  container.appendChild(toolbar);

  // Split layout: tournament list (left) | deleted-draws table (right)
  const layout = document.createElement('div');
  layout.style.cssText = 'display: flex; gap: 16px; min-height: 0; flex: 1; margin-top: 12px;';

  const leftPane = document.createElement('div');
  leftPane.style.cssText = 'flex: 1; min-width: 0; display: flex; flex-direction: column;';
  const leftLabel = document.createElement('div');
  leftLabel.style.cssText = 'font-size: 0.85rem; color: var(--tmx-text-muted); margin-bottom: 4px;';
  leftLabel.textContent = t('system.audit.tournamentsLabel');
  const tournamentTableEl = document.createElement('div');
  tournamentTableEl.id = TOURNAMENT_TABLE_ID;
  leftPane.appendChild(leftLabel);
  leftPane.appendChild(tournamentTableEl);

  const rightPane = document.createElement('div');
  rightPane.style.cssText = 'flex: 1.4; min-width: 0; display: flex; flex-direction: column;';
  const rightLabel = document.createElement('div');
  rightLabel.style.cssText = 'font-size: 0.85rem; color: var(--tmx-text-muted); margin-bottom: 4px;';
  rightLabel.textContent = t('system.audit.deletedDrawsLabel');
  const drawTableEl = document.createElement('div');
  drawTableEl.id = DRAW_TABLE_ID;
  rightPane.appendChild(rightLabel);
  rightPane.appendChild(drawTableEl);

  layout.appendChild(leftPane);
  layout.appendChild(rightPane);
  container.appendChild(layout);

  // State
  let tournaments: CalendarTournament[] = [];
  let selectedTournamentId: string | null = null;

  destroyTable({ anchorId: TOURNAMENT_TABLE_ID });
  destroyTable({ anchorId: DRAW_TABLE_ID });

  const tournamentTable = new Tabulator(tournamentTableEl, {
    placeholder: t('system.audit.noTournaments'),
    layout: 'fitColumns',
    selectableRows: 1,
    maxHeight: 600,
    columns: [
      { title: t('system.audit.tournamentName'), field: 'tournamentName', widthGrow: 2 },
      { title: t('system.audit.startDate'), field: 'startDate', width: 110 },
      { title: t('system.audit.tournamentId'), field: 'tournamentId', widthGrow: 1 },
    ],
    data: [],
  });

  tournamentTable.on('rowClick', (_e: any, row: any) => {
    const data = row.getData() as CalendarTournament;
    selectedTournamentId = data.tournamentId;
    loadDeletedDraws();
  });

  const drawTable = new Tabulator(drawTableEl, {
    placeholder: t('system.audit.selectTournament'),
    layout: 'fitColumns',
    maxHeight: 600,
    columns: [
      { title: t('system.audit.drawName'), field: 'drawName', widthGrow: 2 },
      { title: t('system.audit.eventId'), field: 'eventId', widthGrow: 1 },
      { title: t('system.audit.deletedAt'), field: 'deletedAtFormatted', width: 170 },
      { title: t('system.audit.deletedBy'), field: 'userEmail', widthGrow: 1 },
      {
        title: '',
        field: 'auditId',
        width: 110,
        hozAlign: 'center',
        headerSort: false,
        formatter: () => `<button class="btn-edit">${t('system.audit.restore')}</button>`,
        cellClick: (_e: any, cell: any) => onRestoreClick(cell.getRow().getData()),
      },
    ],
    data: [],
  });

  // Behavior
  const applyTournamentFilter = () => {
    const q = filterInput.value.trim().toLowerCase();
    const filtered = q
      ? tournaments.filter((row) => row.searchText.includes(q))
      : tournaments;
    tournamentTable.replaceData(filtered);
  };

  filterInput.addEventListener('input', applyTournamentFilter);

  const loadCalendar = async () => {
    const abbr = providerSelect.value;
    if (!abbr) return;
    try {
      const res: any = await getCalendar({ providerAbbr: abbr });
      const raw = res?.data?.calendar;
      const entries = Array.isArray(raw) ? raw : [];
      tournaments = entries
        .map((e: any) => ({
          tournamentId: e.tournamentId,
          tournamentName: e.tournament?.tournamentName || '',
          startDate: e.tournament?.startDate || '',
          endDate: e.tournament?.endDate || '',
          searchText: `${e.tournament?.tournamentName || ''} ${e.tournamentId || ''}`.toLowerCase(),
        }))
        .filter((row) => row.tournamentId)
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
      selectedTournamentId = null;
      drawTable.replaceData([]);
      applyTournamentFilter();
    } catch {
      tmxToast({ message: t('system.audit.calendarLoadError'), intent: 'is-danger' });
    }
  };

  providerSelect.addEventListener('change', () => {
    filterInput.value = '';
    void loadCalendar();
  });

  const loadDeletedDraws = async () => {
    if (!selectedTournamentId) return;
    try {
      const res = await getDeletedDraws({ tournamentId: selectedTournamentId });
      const rows = (res?.auditRows ?? []).map(mapAuditRow);
      drawTable.replaceData(rows);
    } catch {
      tmxToast({ message: t('system.audit.deletedDrawsLoadError'), intent: 'is-danger' });
    }
  };

  const onRestoreClick = (row: any) => {
    const drawName = row.drawName || row.drawId || '?';
    const queryEl = document.createElement('div');
    queryEl.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
    appendDetail(queryEl, t('system.audit.drawName'), drawName);
    appendDetail(queryEl, t('system.audit.eventId'), row.eventId || '?');
    appendDetail(queryEl, t('system.audit.deletedAt'), row.deletedAtFormatted || '?');
    appendDetail(queryEl, t('system.audit.deletedBy'), row.userEmail || '?');
    const note = document.createElement('div');
    note.style.cssText = 'margin-top: 8px; font-size: 0.85rem; color: var(--tmx-text-muted);';
    note.textContent = t('system.audit.restorePrompt');
    queryEl.appendChild(note);

    confirmModal({
      title: t('system.audit.restoreTitle'),
      query: queryEl,
      okIntent: 'is-primary',
      okAction: () => void doRestore(row.auditId),
      cancelAction: () => undefined,
    });
  };

  const doRestore = async (auditId: string) => {
    try {
      const res = await restoreDeletedDraw(auditId);
      if (res?.success) {
        tmxToast({ message: t('system.audit.restoreSuccess'), intent: 'is-success' });
        await loadDeletedDraws();
      } else {
        const reason = res?.error || t('system.audit.restoreFailure');
        tmxToast({ message: reason, intent: 'is-danger' });
      }
    } catch {
      tmxToast({ message: t('system.audit.restoreFailure'), intent: 'is-danger' });
    }
  };

  // Bootstrap: pick first provider + load calendar
  if (providerRows.length) {
    providerSelect.value = providerRows[0].organisationAbbreviation;
    void loadCalendar();
  }
}

function mapAuditRow(r: DeletedDrawAuditRow): any {
  const m = r.metadata ?? {};
  return {
    auditId: r.auditId,
    drawId: m.drawId || '',
    drawName: m.drawName || m.drawId || '',
    eventId: m.eventId || '',
    deletedAtFormatted: formatTimestamp(r.occurredAt),
    userEmail: r.userEmail || '',
  };
}

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function appendDetail(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; gap: 8px;';
  const k = document.createElement('span');
  k.style.cssText = 'font-weight: 600; min-width: 110px;';
  k.textContent = `${label}:`;
  const v = document.createElement('span');
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  parent.appendChild(row);
}
