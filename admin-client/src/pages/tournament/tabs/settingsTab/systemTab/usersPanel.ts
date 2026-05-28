import { resetPasswordModal } from 'components/modals/resetPasswordModal';
import { createSearchFilter } from 'components/tables/common/filters/createSearchFilter';
import { buildContactEmailCoverageTile } from './contactEmailCoverageTile';
import { confirmModal } from 'components/modals/baseModal/baseModal';
import { editUserModal } from 'components/modals/editUserModal';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { buildSearchInput } from 'components/inputs/searchInput';
import { createUserModal } from 'components/modals/createUser';
import { removeUser } from 'services/apis/servicesApi';
import { destroyTable } from 'pages/tournament/destroyTable';
import { tmxToast } from 'services/notifications/tmxToast';
import { t } from 'i18n';

const USERS_TABLE = 'systemUsersTable';

type RenderUsersPanelParams = {
  container: HTMLElement;
  providers: any[];
  users: any[];
  onRefresh: () => void;
};

export function renderUsersPanel({ container, providers, users, onRefresh }: RenderUsersPanelParams): void {
  container.innerHTML = '';

  // Backfill nudge tile — fetches its own counts; silently removes
  // itself for non-SUPER_ADMIN callers (the endpoint 403s).
  container.appendChild(buildContactEmailCoverageTile());

  // Build a provider lookup map
  const providerMap: Record<string, string> = {};
  (providers || []).forEach((p) => {
    if (p.key && p.value?.organisationName) {
      providerMap[p.key] = p.value.organisationName;
    }
    if (p.value?.organisationId && p.value?.organisationName) {
      providerMap[p.value.organisationId] = p.value.organisationName;
    }
  });

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'system-users-toolbar';

  let applySearch: (value: string) => void = () => {};
  const search = buildSearchInput({
    placeholder: t('system.searchUsers'),
    onInput: (value: string) => applySearch(value),
  });

  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'toolbar-actions';

  const createBtn = document.createElement('button');
  createBtn.className = 'btn-invite';
  createBtn.textContent = t('system.createUser');

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.textContent = t('system.editUser');

  const resetPwBtn = document.createElement('button');
  resetPwBtn.className = 'btn-impersonate';
  resetPwBtn.textContent = t('system.resetPassword');

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove';
  removeBtn.textContent = t('system.removeUser');

  toolbarActions.appendChild(createBtn);
  toolbarActions.appendChild(editBtn);
  toolbarActions.appendChild(resetPwBtn);
  toolbarActions.appendChild(removeBtn);

  toolbar.appendChild(search.container);
  toolbar.appendChild(toolbarActions);
  container.appendChild(toolbar);

  // Table
  const tableEl = document.createElement('div');
  tableEl.id = USERS_TABLE;
  container.appendChild(tableEl);

  // Resolve all associated provider names per user. Prefers the multi-
  // provider `providerIds[]` (from user_providers) and falls back to the
  // legacy single `providerId` for users with no user_providers rows yet.
  const resolveProviderNames = (user: any): string => {
    const ids: string[] = Array.isArray(user.value?.providerIds) && user.value.providerIds.length
      ? user.value.providerIds
      : (user.value?.providerId ? [user.value.providerId] : []);
    return ids.map((id) => providerMap[id]).filter(Boolean).join(', ');
  };

  const userData = (users || [])
    .map((u) => ({
      firstName: u.value?.firstName || '',
      lastName: u.value?.lastName || '',
      email: u.value?.email || '',
      providerNames: resolveProviderNames(u),
      roles: (u.value?.roles || []).join(', '),
      lastAccess: u.value?.lastAccess || '',
      searchText: `${u.value?.firstName || ''} ${u.value?.lastName || ''} ${u.value?.email || ''}`.toLowerCase(),
      _raw: u,
    }))
    // Pre-sort by lastAccess desc so the initial render is in the right
    // order even if Tabulator's `initialSort` / `tableBuilt setSort` paths
    // misbehave. Falls back to email on ties / never-accessed.
    .sort((a, b) => {
      const ta = a.lastAccess ? new Date(a.lastAccess).getTime() : 0;
      const tb = b.lastAccess ? new Date(b.lastAccess).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return a.email.localeCompare(b.email);
    });

  destroyTable({ anchorId: USERS_TABLE });

  const table = new Tabulator(tableEl, {
    placeholder: t('system.noUsers'),
    selectableRows: 1,
    layout: 'fitColumns',
    maxHeight: 500,
    // Default order is whatever the pre-sorted `userData` array gives us
    // (lastAccess desc, then email). Don't pass `initialSort` — see the
    // matching note in providersPanel.ts. Column-header click sorters
    // below still let users re-sort by anything.
    columns: [
      { title: t('system.firstName'), field: 'firstName', headerSort: true },
      { title: t('system.lastName'), field: 'lastName', headerSort: true },
      { title: 'Email', field: 'email', headerSort: true },
      { title: t('system.providers'), field: 'providerNames', headerSort: true },
      { title: t('system.roles'), field: 'roles', headerSort: false },
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
        formatter: (cell) => {
          const val = cell.getValue();
          if (!val) return '';
          const d = new Date(val);
          return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },
      },
    ],
    data: userData,
  });

  // Search filter — now that the table exists, point the search input at it.
  applySearch = createSearchFilter(table);

  // Get selected user helper
  const getSelectedUser = () => {
    const rows = table.getSelectedRows();
    return rows?.[0]?.getData();
  };

  // Create user button — opens the createUserModal which calls
  // POST /auth/admin-create-user and copies the assigned password to the
  // admin's clipboard. The new user is forced through a change-password
  // flow on first login (server returns a limited token until they do).
  createBtn.addEventListener('click', () => {
    createUserModal(() => onRefresh(), providers as any);
  });

  // Edit button
  editBtn.addEventListener('click', () => {
    const selected = getSelectedUser();
    if (!selected) {
      tmxToast({ message: t('system.selectUserFirst'), intent: 'is-warning' });
      return;
    }
    editUserModal({
      user: selected._raw?.value || selected,
      providers,
      callback: () => onRefresh(),
    });
  });

  // Reset password button
  resetPwBtn.addEventListener('click', () => {
    const selected = getSelectedUser();
    if (!selected) {
      tmxToast({ message: t('system.selectUserFirst'), intent: 'is-warning' });
      return;
    }
    resetPasswordModal({
      email: selected.email,
      displayName: `${selected.firstName} ${selected.lastName}`.trim() || selected.email,
    });
  });

  // Remove button
  removeBtn.addEventListener('click', () => {
    const selected = getSelectedUser();
    if (!selected) {
      tmxToast({ message: t('system.selectUserFirst'), intent: 'is-warning' });
      return;
    }
    const displayName = `${selected.firstName} ${selected.lastName} (${selected.email})`;
    confirmModal({
      title: t('system.confirmRemoveUser'),
      query: `${t('system.removeUserConfirm')} ${displayName}?`,
      okIntent: 'is-danger',
      cancelAction: undefined,
      okAction: () => {
        removeUser({ email: selected.email }).then(() => {
          tmxToast({ message: `${displayName} removed`, intent: 'is-success' });
          onRefresh();
        });
      },
    });
  });
}
