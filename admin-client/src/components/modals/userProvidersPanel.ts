/**
 * Multi-provider association panel for the Edit User modal.
 *
 * Backed by the Phase 1 endpoints in `UsersProvidersController`. The
 * server filters list responses by the editor's authorised providers,
 * so a SUPER_ADMIN sees every association the user has and a
 * PROVIDER_ADMIN only sees rows at their own provider(s). The UI
 * here just renders whatever the server returns; it doesn't
 * re-implement scope rules client-side.
 *
 * Eager-commit semantics — each add / role change / remove fires its
 * own request and updates the visible list immediately. Failures show
 * a toast and the row reverts. No "Save" button for this panel — the
 * modal's outer save button still handles the legacy
 * roles/permissions/services arrays via `modifyUser`.
 */
import {
  listUserProviders,
  setUserProvider,
  removeUserProvider,
  type UserProviderAssociation,
} from 'services/apis/servicesApi';
import { tmxToast } from 'services/notifications/tmxToast';
import { confirmModal } from './baseModal/baseModal';
import { t } from 'i18n';

import { SUPER_ADMIN } from 'constants/tmxConstants';

interface UserProvidersPanelParams {
  /** UUID of the user whose associations are being edited. */
  userId: string;
  /** Editor's roles (from getLoginState().roles). Drives the "can add" affordance. */
  editorRoles: string[];
  /**
   * Full list of providers (`{key, value}` pairs) for the Add typeahead.
   * Only used when the editor is a super-admin — provider admins can't
   * add associations to other providers from this panel.
   */
  providers: Array<{ key: string; value: any }>;
}

const PROVIDER_ROLES: Array<'PROVIDER_ADMIN' | 'DIRECTOR'> = ['PROVIDER_ADMIN', 'DIRECTOR'];

/**
 * Build the provider-associations panel as a standalone DOM node.
 * Caller appends it where appropriate inside the modal.
 */
export function buildUserProvidersPanel(params: UserProvidersPanelParams): HTMLElement {
  const { userId, editorRoles, providers } = params;
  const isSuperAdmin = editorRoles.includes(SUPER_ADMIN);

  const root = document.createElement('div');
  root.className = 'user-providers-panel';
  root.style.cssText = 'margin: 1em 0;';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'font-weight: bold; font-size: larger; margin-bottom: 0.5em;';
  header.textContent = t('modals.editUser.providers');
  root.appendChild(header);

  // List body — re-rendered on every mutation
  const body = document.createElement('div');
  body.className = 'user-providers-list';
  root.appendChild(body);

  let currentRows: UserProviderAssociation[] = [];

  const refresh = async () => {
    body.innerHTML = '';
    body.appendChild(loadingPlaceholder());
    try {
      currentRows = await listUserProviders({ userId });
    } catch {
      currentRows = [];
    }
    body.innerHTML = '';
    if (!currentRows.length) {
      body.appendChild(emptyPlaceholder(isSuperAdmin));
    } else {
      for (const row of currentRows) body.appendChild(renderRow(row, refresh));
    }
    if (isSuperAdmin) body.appendChild(buildAddRow(userId, currentRows, providers, refresh));
  };

  void refresh();

  return root;
}

// ── Row render ────────────────────────────────────────────────────────────

function renderRow(row: UserProviderAssociation, refresh: () => Promise<void>): HTMLElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'user-providers-row';
  rowEl.style.cssText =
    'display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--tmx-border-secondary, #ddd);';

  const name = document.createElement('div');
  name.style.cssText = 'flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
  name.textContent = row.organisationName || row.providerId;
  if (row.organisationAbbreviation) {
    const abbr = document.createElement('span');
    abbr.style.cssText = 'opacity: 0.6; margin-left: 6px; font-size: 0.85em;';
    abbr.textContent = `(${row.organisationAbbreviation})`;
    name.appendChild(abbr);
  }
  rowEl.appendChild(name);

  // Role dropdown
  const roleSelect = document.createElement('select');
  roleSelect.style.cssText = 'min-width: 160px;';
  for (const r of PROVIDER_ROLES) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    if (r === row.providerRole) opt.selected = true;
    roleSelect.appendChild(opt);
  }
  roleSelect.addEventListener('change', async () => {
    const previous = row.providerRole;
    const next = roleSelect.value as 'PROVIDER_ADMIN' | 'DIRECTOR';
    if (next === previous) return;
    try {
      const updated = await setUserProvider({
        userId: row.userId,
        providerId: row.providerId,
        providerRole: next,
      });
      if (updated) {
        tmxToast({
          message: t('modals.editUser.providerRoleUpdated', { role: next }),
          intent: 'is-success',
        });
        await refresh();
      } else {
        // Server rejected (e.g. 409 last-admin-block) — revert UI.
        roleSelect.value = previous;
      }
    } catch {
      roleSelect.value = previous;
    }
  });
  rowEl.appendChild(roleSelect);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove';
  removeBtn.style.cssText = 'padding: 4px 10px;';
  removeBtn.textContent = t('common.remove');
  removeBtn.addEventListener('click', () => {
    confirmModal({
      title: t('modals.editUser.removeProviderTitle'),
      query: t('modals.editUser.removeProviderConfirm', {
        provider: row.organisationName || row.providerId,
      }),
      cancelAction: undefined,
      okIntent: 'is-warning',
      okAction: async () => {
        try {
          await removeUserProvider({ userId: row.userId, providerId: row.providerId });
          tmxToast({ message: t('modals.editUser.providerRemoved'), intent: 'is-success' });
          await refresh();
        } catch {
          // Toast already raised by baseApi interceptor.
        }
      },
    });
  });
  rowEl.appendChild(removeBtn);

  return rowEl;
}

// ── Add-provider row (super-admin only) ───────────────────────────────────

function buildAddRow(
  userId: string,
  existingRows: UserProviderAssociation[],
  allProviders: Array<{ key: string; value: any }>,
  refresh: () => Promise<void>,
): HTMLElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'user-providers-add-row';
  rowEl.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 8px 0; margin-top: 6px;';

  // Compute providers not already associated
  const existingIds = new Set(existingRows.map((r) => r.providerId));
  const unassigned = allProviders.filter((p) => !existingIds.has(p.key));

  const select = document.createElement('select');
  select.style.cssText = 'flex: 1;';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = t('modals.editUser.addProviderPlaceholder');
  select.appendChild(placeholder);
  for (const p of unassigned) {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.value?.organisationName || p.key;
    select.appendChild(opt);
  }
  rowEl.appendChild(select);

  const roleSelect = document.createElement('select');
  for (const r of PROVIDER_ROLES) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    if (r === 'DIRECTOR') opt.selected = true;
    roleSelect.appendChild(opt);
  }
  rowEl.appendChild(roleSelect);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-edit';
  addBtn.style.cssText = 'padding: 4px 10px;';
  addBtn.textContent = t('modals.editUser.addProvider');
  addBtn.addEventListener('click', async () => {
    const providerId = select.value;
    if (!providerId) return;
    try {
      await setUserProvider({
        userId,
        providerId,
        providerRole: roleSelect.value as 'PROVIDER_ADMIN' | 'DIRECTOR',
      });
      tmxToast({ message: t('modals.editUser.providerAdded'), intent: 'is-success' });
      await refresh();
    } catch {
      // Toast already raised by baseApi interceptor.
    }
  });
  rowEl.appendChild(addBtn);

  return rowEl;
}

// ── Placeholders ──────────────────────────────────────────────────────────

function loadingPlaceholder(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'opacity: 0.6; padding: 8px 0;';
  el.textContent = t('common.loading');
  return el;
}

function emptyPlaceholder(isSuperAdmin: boolean): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'opacity: 0.7; font-style: italic; padding: 8px 0;';
  el.textContent = isSuperAdmin
    ? t('modals.editUser.noProviders')
    : t('modals.editUser.noProvidersAtYourScope');
  return el;
}
