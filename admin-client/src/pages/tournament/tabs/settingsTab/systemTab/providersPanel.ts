import { resetPasswordModal } from 'components/modals/resetPasswordModal';
import { createSearchFilter } from 'components/tables/common/filters/createSearchFilter';
import { setActiveProvider, clearActiveProvider } from 'services/provider/providerState';
import { editProviderModal } from 'components/modals/editProvider';
import { archiveProviderModal } from 'components/modals/archiveProvider';
import { deleteProviderModal } from 'components/modals/deleteProvider';
import { generatedKeyModal } from 'components/modals/generatedKeyModal';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { buildSearchInput } from 'components/inputs/searchInput';
import { removeUserProvider } from 'services/apis/servicesApi';
import { listProviderKeys, generateProviderKey, revokeProviderKey } from 'services/apis/providerKeysApi';
import { destroyTable } from 'pages/tournament/destroyTable';
import { openTmxImpersonate } from 'services/openTmxImpersonate';
import { createUserModal } from 'components/modals/createUser';
import { confirmModal, openModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { renderForm } from 'courthive-components';
import { t } from 'i18n';

const PROVIDER_LIST_TABLE = 'systemProviderListTable';
const PROVIDER_USERS_TABLE = 'systemProviderUsersTable';
const PROVIDER_KEYS_TABLE = 'systemProviderKeysTable';

function formatDateTime(value: string | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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

  // Wired below once the table exists; the closure lets us register the
  // search input now and still call setSearchFilter once it's defined.
  let applySearch: (value: string) => void = () => {};
  const search = buildSearchInput({
    placeholder: t('system.searchProviders'),
    onInput: (value: string) => applySearch(value),
  });

  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'toolbar-actions';

  const createBtn = document.createElement('button');
  createBtn.className = 'btn-invite';
  createBtn.textContent = t('system.createProvider');
  createBtn.addEventListener('click', () => editProviderModal({ callback: () => onRefresh() }));

  toolbarActions.appendChild(createBtn);

  toolbar.appendChild(search.container);
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

  // Search filter — now that the table exists, point the search input at it.
  applySearch = createSearchFilter(table);
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

  const createBtn = document.createElement('button');
  createBtn.className = 'btn-invite';
  createBtn.textContent = t('system.createUser');
  // createUserModal POSTs to /auth/admin-create-user with the assigned
  // password and copies it to the admin's clipboard. The new user is
  // forced through the first-login change-password flow on their next
  // sign-in (must_change_password = TRUE on the row).
  createBtn.addEventListener('click', () => {
    createUserModal(() => onRefresh(), providers as any, provider.organisationId);
  });

  // Plan A — Archive (warning intent) + Delete (danger intent). Both
  // SUPER_ADMIN only (server enforces). Archive is recoverable via
  // revive-provider.mjs; Delete is irreversible. Buttons live on the
  // right with separators so they don't get clicked by accident.
  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'btn-edit';
  archiveBtn.style.cssText = 'margin-left: auto;';
  archiveBtn.textContent = t('system.archiveProvider');
  archiveBtn.addEventListener('click', () => {
    archiveProviderModal({
      providerId: provider.organisationId,
      providerAbbr: provider.organisationAbbreviation,
      providerName: provider.organisationName,
      callback: () => onRefresh(),
    });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-remove';
  deleteBtn.textContent = t('system.deleteProvider');
  deleteBtn.addEventListener('click', () => {
    deleteProviderModal({
      providerId: provider.organisationId,
      providerAbbr: provider.organisationAbbreviation,
      providerName: provider.organisationName,
      callback: () => onRefresh(),
    });
  });

  actions.appendChild(impersonateBtn);
  actions.appendChild(editBtn);
  actions.appendChild(createBtn);
  actions.appendChild(archiveBtn);
  actions.appendChild(deleteBtn);
  detailPane.appendChild(actions);

  detailPane.appendChild(buildProviderKeysSection(provider, () => renderProviderDetail({ detailPane, provider, providers, users, onRefresh })));

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

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove';
  removeBtn.style.fontSize = '0.75rem';
  removeBtn.textContent = t('common.remove');
  assocHeader.appendChild(removeBtn);

  assocSection.appendChild(assocHeader);

  const assocTableEl = document.createElement('div');
  assocTableEl.id = PROVIDER_USERS_TABLE;
  assocSection.appendChild(assocTableEl);
  detailPane.appendChild(assocSection);

  const filteredUsers = (users || [])
    .filter((u) => {
      // Multi-provider associations live in user_providers; the server now
      // returns them as `providerIds[]`. Fall back to the legacy single
      // `providerId` column when the array is absent or empty (older server
      // versions, or users with no user_providers rows yet).
      const ids = u.value?.providerIds;
      if (Array.isArray(ids) && ids.length) return ids.includes(provider.organisationId);
      return u.value?.providerId === provider.organisationId;
    })
    .map((u) => ({
      userId: u.value?.userId,
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

  removeBtn.addEventListener('click', () => {
    const rows = assocTable.getSelectedRows();
    const selected = rows?.[0]?.getData();
    if (!selected) {
      tmxToast({ message: t('system.selectUserFirst'), intent: 'is-warning' });
      return;
    }
    if (!selected.userId) {
      tmxToast({ message: 'User has no userId', intent: 'is-danger' });
      return;
    }
    const displayName = `${selected.firstName} ${selected.lastName}`.trim() || selected.email;
    confirmModal({
      title: t('modals.editUser.removeProviderTitle'),
      query: t('modals.editUser.removeProviderConfirm', {
        provider: provider.organisationName || provider.organisationAbbreviation,
      }) + ` (${displayName})`,
      cancelAction: undefined,
      okIntent: 'is-warning',
      okAction: async () => {
        try {
          await removeUserProvider({ userId: selected.userId, providerId: provider.organisationId });
          tmxToast({ message: t('modals.editUser.providerRemoved'), intent: 'is-success' });
          onRefresh();
        } catch {
          // baseApi interceptor raises a toast on error.
        }
      },
    });
  });
}

function buildProviderKeysSection(provider: any, refresh: () => void): HTMLElement {
  const section = document.createElement('div');
  section.className = 'system-associated-users';

  const sectionHeader = document.createElement('div');
  sectionHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
  sectionHeader.innerHTML = `<h4 style="margin: 0;">${t('system.apiKeys')}</h4>`;

  const generateBtn = document.createElement('button');
  generateBtn.className = 'btn-invite';
  generateBtn.style.fontSize = '0.75rem';
  generateBtn.textContent = t('system.generateKey');
  generateBtn.addEventListener('click', () => openGenerateProviderKeyModal(provider, refresh));
  sectionHeader.appendChild(generateBtn);

  section.appendChild(sectionHeader);

  const tableEl = document.createElement('div');
  tableEl.id = PROVIDER_KEYS_TABLE;
  section.appendChild(tableEl);

  listProviderKeys(provider.organisationId).then(
    (res: any) => {
      const keys = res?.data?.keys ?? [];
      const data = keys.map((k: any) => ({
        ...k,
        status: k.isActive ? t('system.active') : t('system.revoked'),
      }));
      destroyTable({ anchorId: PROVIDER_KEYS_TABLE });
      const keysTable = new Tabulator(tableEl, {
        placeholder: t('system.noKeys'),
        layout: 'fitColumns',
        maxHeight: 250,
        columns: [
          { title: t('system.label'), field: 'label', headerSort: true },
          { title: t('system.status'), field: 'status', headerSort: true, width: 90 },
          {
            title: t('system.created'),
            field: 'createdAt',
            headerSort: true,
            formatter: (cell: any) => formatDateTime(cell.getValue()),
          },
          {
            title: t('system.lastUsed'),
            field: 'lastUsedAt',
            headerSort: true,
            formatter: (cell: any) => formatDateTime(cell.getValue()),
          },
          {
            title: '',
            width: 90,
            hozAlign: 'center',
            headerSort: false,
            formatter: (cell: any) =>
              cell.getRow().getData().isActive
                ? `<button class="btn-remove" style="font-size:.7rem;padding:2px 8px;">${t('system.revoke')}</button>`
                : '',
            cellClick: (_e: any, cell: any) => {
              const row = cell.getRow().getData();
              if (!row.isActive) return;
              confirmModal({
                title: t('system.revokeKey'),
                query: t('system.revokeKeyConfirm', { label: row.label || row.keyId }),
                okIntent: 'is-warning',
                okAction: () => {
                  revokeProviderKey(provider.organisationId, row.keyId).then(
                    () => {
                      tmxToast({ message: t('system.keyRevoked'), intent: 'is-success' });
                      refresh();
                    },
                    () => tmxToast({ message: t('system.updateFailed'), intent: 'is-danger' }),
                  );
                },
                cancelAction: undefined,
              });
            },
          },
        ],
        data,
      });
      // Hold a reference to silence unused-var lint; keysTable is owned by Tabulator.
      void keysTable;
    },
    () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
  );

  return section;
}

function openGenerateProviderKeyModal(provider: any, refresh: () => void) {
  let inputs: any;
  const content = (elem: HTMLElement) => {
    inputs = renderForm(elem, [
      {
        label: t('system.keyLabel'),
        field: 'label',
        placeholder: t('system.keyLabelPlaceholder'),
      },
    ]);
  };

  openModal({
    title: t('system.generateKey'),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      {
        label: t('system.generate'),
        intent: 'is-primary',
        close: true,
        onClick: () => {
          const label = inputs?.label?.value?.trim() || undefined;
          generateProviderKey(provider.organisationId, label).then(
            (res: any) => {
              const apiKey = res?.data?.apiKey;
              if (!apiKey) {
                tmxToast({ message: t('system.generateFailed'), intent: 'is-danger' });
                return;
              }
              generatedKeyModal({
                apiKey,
                label,
                providerName: provider.organisationName || provider.organisationAbbreviation,
              });
              refresh();
            },
            () => tmxToast({ message: t('system.generateFailed'), intent: 'is-danger' }),
          );
        },
      },
    ],
  });
}
