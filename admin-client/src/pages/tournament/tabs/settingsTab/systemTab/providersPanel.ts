import { resetPasswordModal } from 'components/modals/resetPasswordModal';
import { createSearchFilter } from 'components/tables/common/filters/createSearchFilter';
import { setActiveProvider, clearActiveProvider } from 'services/provider/providerState';
import { editProviderModal } from 'components/modals/editProvider';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { destroyTable } from 'pages/tournament/destroyTable';
import { openTmxImpersonate } from 'services/openTmxImpersonate';
import { inviteModal } from 'components/modals/inviteUser';
import { tmxToast } from 'services/notifications/tmxToast';
import { t } from 'i18n';

const PROVIDER_LIST_TABLE = 'systemProviderListTable';
const PROVIDER_USERS_TABLE = 'systemProviderUsersTable';

type RenderProvidersPanelParams = {
  container: HTMLElement;
  providers: any[];
  users: any[];
  onRefresh: () => void;
};

export function renderProvidersPanel({ container, providers, users, onRefresh }: RenderProvidersPanelParams): void {
  container.innerHTML = '';

  // Toolbar (matches usersPanel pattern)
  const toolbar = document.createElement('div');
  toolbar.className = 'system-users-toolbar';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = t('system.searchProviders');
  searchInput.style.cssText =
    'padding: 6px 10px; border: 1px solid var(--tmx-border-primary); border-radius: 4px; font-size: 0.85rem; min-width: 200px; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';

  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'toolbar-actions';

  const createBtn = document.createElement('button');
  createBtn.className = 'btn-invite';
  createBtn.textContent = t('system.createProvider');
  createBtn.addEventListener('click', () => editProviderModal({ callback: () => onRefresh() }));

  toolbarActions.appendChild(createBtn);

  toolbar.appendChild(searchInput);
  toolbar.appendChild(toolbarActions);
  container.appendChild(toolbar);

  const layout = document.createElement('div');
  layout.className = 'system-providers-layout';

  // Left pane: provider list
  const listPane = document.createElement('div');
  listPane.className = 'system-provider-list';
  const listTableEl = document.createElement('div');
  listTableEl.id = PROVIDER_LIST_TABLE;
  listPane.appendChild(listTableEl);

  // Right pane: provider detail
  const detailPane = document.createElement('div');
  detailPane.className = 'system-provider-detail';
  detailPane.innerHTML = `<div class="system-no-selection">${t('system.selectProvider')}</div>`;

  layout.appendChild(listPane);
  layout.appendChild(detailPane);
  container.appendChild(layout);

  const providerData = (providers || [])
    .map((p) => ({
      organisationName: p.value?.organisationName || '',
      organisationAbbreviation: p.value?.organisationAbbreviation || '',
      organisationId: p.value?.organisationId || p.key || '',
      lastAccess: p.value?.lastAccess || '',
      searchText: `${p.value?.organisationName || ''} ${p.value?.organisationAbbreviation || ''}`.toLowerCase(),
      _raw: p,
    }))
    // Pre-sort by lastAccess desc so the initial render is in the right
    // order even if Tabulator's `initialSort` / `tableBuilt setSort` paths
    // misbehave. Falls back to organisation name on ties / never-accessed.
    .sort((a, b) => {
      const ta = a.lastAccess ? new Date(a.lastAccess).getTime() : 0;
      const tb = b.lastAccess ? new Date(b.lastAccess).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return a.organisationName.localeCompare(b.organisationName);
    });

  // Diagnostic: surface the first few rows + the count of populated
  // lastAccess values so we can tell from the console whether the
  // server payload actually carries timestamps.
  const populated = providerData.filter((p) => p.lastAccess).length;
  console.log(
    `[providers] rendering ${providerData.length} rows (${populated} with lastAccess), top 3:`,
    providerData.slice(0, 3).map((p) => ({ name: p.organisationName, lastAccess: p.lastAccess })),
  );

  destroyTable({ anchorId: PROVIDER_LIST_TABLE });

  const table = new Tabulator(listTableEl, {
    placeholder: t('system.noProviders'),
    selectableRows: 1,
    layout: 'fitColumns',
    maxHeight: 500,
    // Default order is whatever the pre-sorted `providerData` array
    // gives us (lastAccess desc, then name). Don't pass `initialSort`
    // here — its interaction with the custom column sorter was reshuffling
    // the rows alphabetically on first paint despite the array already
    // being correctly ordered. The column-header click sorters below
    // still let users re-sort by anything.
    columns: [
      { title: t('system.providerName'), field: 'organisationName', headerSort: true },
      { title: t('system.providerAbbr'), field: 'organisationAbbreviation', headerSort: true },
      {
        title: t('system.lastAccess'),
        field: 'lastAccess',
        headerSort: true,
        // Custom sorter — Tabulator's built-in 'datetime' sorter requires
        // Luxon, which isn't a dep here. Coerce to epoch ms; empty/missing
        // sorts to one end so default desc-by-lastAccess pushes never-
        // accessed rows to the bottom.
        sorter: (a: any, b: any) => {
          const ta = a ? new Date(a).getTime() : 0;
          const tb = b ? new Date(b).getTime() : 0;
          return ta - tb;
        },
        formatter: (cell: any) => {
          const val = cell.getValue();
          if (!val) return '';
          const d = new Date(val);
          return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },
      },
    ],
    data: providerData,
  });

  table.on('rowSelectionChanged', (_data, rows) => {
    const selected = rows?.[0]?.getData();
    if (selected) {
      // Auto-set as active provider on selection
      setActiveProvider(
        selected._raw?.value || {
          organisationName: selected.organisationName,
          organisationAbbreviation: selected.organisationAbbreviation,
          organisationId: selected.organisationId,
        },
      );
      renderProviderDetail({ detailPane, provider: selected, providers, users, onRefresh });
    } else {
      clearActiveProvider();
      detailPane.innerHTML = `<div class="system-no-selection">${t('system.selectProvider')}</div>`;
    }
  });

  // Search filter
  const setSearchFilter = createSearchFilter(table);
  searchInput.addEventListener('input', (e: any) => setSearchFilter(e.target.value));
  searchInput.addEventListener('keydown', (e: any) => {
    if (e.keyCode === 8 && e.target.value.length === 1) setSearchFilter('');
  });
}

type RenderProviderDetailParams = {
  detailPane: HTMLElement;
  provider: any;
  providers: any[];
  users: any[];
  onRefresh: () => void;
};

function renderProviderDetail({ detailPane, provider, providers, users, onRefresh }: RenderProviderDetailParams): void {
  detailPane.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'system-detail-header';
  header.innerHTML = `
    <h3>${provider.organisationName}</h3>
    <div class="detail-meta">${provider.organisationAbbreviation} &middot; ${provider.organisationId}</div>
  `;
  detailPane.appendChild(header);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'system-detail-actions';

  const impersonateBtn = document.createElement('button');
  impersonateBtn.className = 'btn-impersonate';
  impersonateBtn.textContent = t('system.impersonate');
  impersonateBtn.addEventListener('click', () => {
    const providerValue = provider._raw?.value || {
      organisationName: provider.organisationName,
      organisationAbbreviation: provider.organisationAbbreviation,
      organisationId: provider.organisationId,
    };
    setActiveProvider(providerValue);
    void openTmxImpersonate(providerValue);
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.textContent = t('system.editProvider');
  editBtn.addEventListener('click', () => {
    const providerValue = provider._raw?.value || {
      organisationName: provider.organisationName,
      organisationAbbreviation: provider.organisationAbbreviation,
      organisationId: provider.organisationId,
    };
    editProviderModal({ provider: providerValue, callback: () => onRefresh() });
  });

  const inviteBtn = document.createElement('button');
  inviteBtn.className = 'btn-invite';
  inviteBtn.textContent = t('system.inviteUser');
  // inviteModal handles the URL log + clipboard copy and surfaces failures via
  // toast — refresh the provider/user lists whenever an inviteCode came back.
  inviteBtn.addEventListener('click', () => {
    inviteModal(
      (result: any) => {
        if (result?.data?.inviteCode) onRefresh();
      },
      providers as any,
      provider.organisationId,
    );
  });

  actions.appendChild(impersonateBtn);
  actions.appendChild(editBtn);
  actions.appendChild(inviteBtn);
  detailPane.appendChild(actions);

  // Associated users
  const assocSection = document.createElement('div');
  assocSection.className = 'system-associated-users';

  const assocHeader = document.createElement('div');
  assocHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
  assocHeader.innerHTML = `<h4 style="margin: 0;">${t('system.associatedUsers')}</h4>`;

  const resetPwBtn = document.createElement('button');
  resetPwBtn.className = 'btn-impersonate';
  resetPwBtn.style.fontSize = '0.75rem';
  resetPwBtn.textContent = t('system.resetPassword');
  assocHeader.appendChild(resetPwBtn);

  assocSection.appendChild(assocHeader);

  const assocTableEl = document.createElement('div');
  assocTableEl.id = PROVIDER_USERS_TABLE;
  assocSection.appendChild(assocTableEl);
  detailPane.appendChild(assocSection);

  const filteredUsers = (users || [])
    .filter((u) => u.value?.providerId === provider.organisationId)
    .map((u) => ({
      firstName: u.value?.firstName || '',
      lastName: u.value?.lastName || '',
      email: u.value?.email || '',
      roles: (u.value?.roles || []).join(', '),
      lastAccess: u.value?.lastAccess || '',
      searchText: `${u.value?.firstName || ''} ${u.value?.lastName || ''} ${u.value?.email || ''}`.toLowerCase(),
    }));

  destroyTable({ anchorId: PROVIDER_USERS_TABLE });

  const assocTable = new Tabulator(assocTableEl, {
    placeholder: t('system.noUsersForProvider'),
    selectableRows: 1,
    layout: 'fitColumns',
    maxHeight: 300,
    columns: [
      { title: t('system.firstName'), field: 'firstName', headerSort: true },
      { title: t('system.lastName'), field: 'lastName', headerSort: true },
      { title: 'Email', field: 'email', headerSort: true },
      { title: t('system.roles'), field: 'roles', headerSort: false },
      {
        title: t('system.lastAccess'),
        field: 'lastAccess',
        headerSort: true,
        formatter: (cell: any) => {
          const val = cell.getValue();
          if (!val) return '';
          const d = new Date(val);
          return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },
      },
    ],
    data: filteredUsers,
  });

  resetPwBtn.addEventListener('click', () => {
    const rows = assocTable.getSelectedRows();
    const selected = rows?.[0]?.getData();
    if (!selected) {
      tmxToast({ message: t('system.selectUserFirst'), intent: 'is-warning' });
      return;
    }
    resetPasswordModal({
      email: selected.email,
      displayName: `${selected.firstName} ${selected.lastName}`.trim() || selected.email,
    });
  });
}
