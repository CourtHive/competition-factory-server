import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { destroyTable } from 'pages/tournament/destroyTable';
import { tmxToast } from 'services/notifications/tmxToast';
import { getPresence, type PresenceResponse, type PresenceMember } from 'services/apis/presenceApi';
import { t } from 'i18n';

const TABLE_ID = 'systemActiveRoomsTable';
const POLL_MS = 5000;

interface RoomRow {
  tournamentId: string;
  count: number;
  emails: string;
  providers: string;
  takenAt: number;
  _members: PresenceMember[];
}

type RenderActiveRoomsPanelParams = {
  container: HTMLElement;
};

interface PanelLifecycle {
  destroy: () => void;
}

let activePanel: PanelLifecycle | null = null;

/** Stop the polling loop on the previously rendered panel, if any. */
export function destroyActiveRoomsPanel(): void {
  activePanel?.destroy();
  activePanel = null;
}

export function renderActiveRoomsPanel({ container }: RenderActiveRoomsPanelParams): void {
  destroyActiveRoomsPanel();
  container.innerHTML = '';

  // Toolbar — refresh button + status
  const toolbar = document.createElement('div');
  toolbar.className = 'system-users-toolbar';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight: 600; font-size: 0.95rem;';
  titleEl.textContent = t('system.activeRoomsTitle');

  const refreshGroup = document.createElement('div');
  refreshGroup.className = 'toolbar-actions';
  refreshGroup.style.cssText = 'display: flex; align-items: center; gap: 12px;';

  const lastRefreshedEl = document.createElement('span');
  lastRefreshedEl.style.cssText = 'font-size: 0.75rem; color: var(--tmx-text-muted, #888);';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn-edit';
  refreshBtn.textContent = t('system.refreshNow');

  refreshGroup.appendChild(lastRefreshedEl);
  refreshGroup.appendChild(refreshBtn);

  toolbar.appendChild(titleEl);
  toolbar.appendChild(refreshGroup);
  container.appendChild(toolbar);

  // Table mount
  const tableEl = document.createElement('div');
  tableEl.id = TABLE_ID;
  container.appendChild(tableEl);

  destroyTable({ anchorId: TABLE_ID });

  const table = new Tabulator(tableEl, {
    placeholder: t('system.noActiveRooms'),
    selectableRows: 1,
    layout: 'fitColumns',
    maxHeight: 600,
    rowFormatter: (row) => formatExpandedRow(row),
    columns: [
      { title: t('system.tournamentColumn'), field: 'tournamentId', headerSort: true, widthGrow: 2 },
      { title: t('system.userCountColumn'), field: 'count', headerSort: true, hozAlign: 'center', width: 130 },
      { title: t('system.provider'), field: 'providers', headerSort: true, widthGrow: 2 },
      { title: 'Email', field: 'emails', headerSort: false, widthGrow: 3 },
    ],
    data: [],
  });

  let cancelled = false;
  let lastTakenAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let agoTimer: ReturnType<typeof setInterval> | undefined;

  const updateLastRefreshedLabel = () => {
    if (!lastTakenAt) {
      lastRefreshedEl.textContent = '';
      return;
    }
    const ago = Math.max(0, Math.round((Date.now() - lastTakenAt) / 1000));
    lastRefreshedEl.textContent = t('system.lastRefreshed', { ago });
  };

  const refresh = async () => {
    try {
      const data = await getPresence();
      if (cancelled) return;
      applyPresenceToTable(table, data);
      lastTakenAt = data?.takenAt ?? Date.now();
      updateLastRefreshedLabel();
    } catch {
      tmxToast({ message: t('system.presenceLoadError'), intent: 'is-danger' });
    } finally {
      if (!cancelled) {
        timer = setTimeout(() => void refresh(), POLL_MS);
      }
    }
  };

  refreshBtn.addEventListener('click', () => {
    if (timer) clearTimeout(timer);
    void refresh();
  });

  agoTimer = setInterval(updateLastRefreshedLabel, 1000);

  void refresh();

  activePanel = {
    destroy: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (agoTimer) clearInterval(agoTimer);
      destroyTable({ anchorId: TABLE_ID });
    },
  };
}

/**
 * Build the per-row expanded content (one line per member with email,
 * provider, and joinedAt). Tabulator calls this on every row render.
 */
function formatExpandedRow(row: any): void {
  const data = row.getData() as RoomRow;
  const members = data._members ?? [];
  if (!members.length) return;

  const existing = row.getElement().querySelector('.active-room-members');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.className = 'active-room-members';
  wrap.style.cssText = 'padding: 6px 12px 10px 24px; font-size: 0.78rem; color: var(--tmx-text-secondary, #555); border-top: 1px dashed var(--tmx-border-secondary, #ddd);';

  for (const m of members) {
    const line = document.createElement('div');
    line.style.cssText = 'display: flex; gap: 12px; padding: 2px 0;';
    const email = document.createElement('span');
    email.style.flex = '2';
    email.textContent = m.email || t('system.anonymous');
    const provider = document.createElement('span');
    provider.style.flex = '2';
    provider.textContent = m.providerName || m.providerId || '';
    const joined = document.createElement('span');
    joined.style.flex = '1';
    joined.textContent = m.joinedAt ? `${t('system.joinedAt')}: ${formatJoinedAt(m.joinedAt)}` : '';
    line.appendChild(email);
    line.appendChild(provider);
    line.appendChild(joined);
    wrap.appendChild(line);
  }
  row.getElement().appendChild(wrap);
}

function formatJoinedAt(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function applyPresenceToTable(table: any, data: PresenceResponse | null): void {
  const rooms = data?.rooms ?? [];
  const rows: RoomRow[] = rooms.map((r) => {
    const emails = r.members.map((m) => m.email || t('system.anonymous')).join(', ');
    const providers = uniqueJoin(r.members.map((m) => m.providerName || m.providerId || ''));
    return {
      tournamentId: r.tournamentId,
      count: r.count,
      emails,
      providers,
      takenAt: data?.takenAt ?? 0,
      _members: r.members,
    };
  });
  table.replaceData(rows);
}

function uniqueJoin(values: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.join(', ');
}
