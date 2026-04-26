import {
  listMyProviders,
  listMyProviderUsers,
  createUserAsProvisioner,
} from 'services/apis/provisionerWorkspaceApi';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { destroyTable } from 'pages/tournament/destroyTable';
import { openModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { renderForm } from 'courthive-components';
import { t } from 'i18n';

const TABLE_ID = 'provisionerUsersTable';

export function renderProvisionerUsersPanel({ container }: { container: HTMLElement }): void {
  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'system-users-toolbar';

  const providerSelect = document.createElement('select');
  providerSelect.style.cssText =
    'padding: 6px 10px; border: 1px solid var(--tmx-border-primary); border-radius: 4px; font-size: 0.85rem; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636); min-width: 220px;';
  providerSelect.innerHTML = `<option value="">${t('provisioner.selectProvider')}</option>`;
  toolbar.appendChild(providerSelect);

  const actions = document.createElement('div');
  actions.className = 'toolbar-actions';
  const createBtn = document.createElement('button');
  createBtn.className = 'btn-invite';
  createBtn.disabled = true;
  createBtn.textContent = t('provisioner.createUser');
  actions.appendChild(createBtn);
  toolbar.appendChild(actions);

  container.appendChild(toolbar);

  const tableEl = document.createElement('div');
  tableEl.id = TABLE_ID;
  tableEl.style.cssText = 'border: 1px solid var(--tmx-border-secondary); border-radius: 8px; padding: 12px; margin-top: 12px;';
  container.appendChild(tableEl);

  let providers: any[] = [];
  let activeProviderId = '';

  const renderUsers = (providerId: string) => {
    if (!providerId) {
      destroyTable({ anchorId: TABLE_ID });
      tableEl.innerHTML = `<div class="system-no-selection">${t('provisioner.selectProvider')}</div>`;
      return;
    }
    listMyProviderUsers(providerId).then(
      (res: any) => {
        const users = res?.data?.users ?? [];
        destroyTable({ anchorId: TABLE_ID });
        new Tabulator(tableEl, {
          placeholder: t('provisioner.noUsers'),
          layout: 'fitColumns',
          maxHeight: 500,
          columns: [
            { title: 'Email', field: 'email', headerSort: true },
            { title: t('system.roles'), field: 'providerRole', headerSort: true, width: 160 },
            { title: 'SSO Provider', field: 'ssoProvider', headerSort: true, width: 140 },
            { title: 'External ID', field: 'externalId', headerSort: true },
          ],
          data: users,
        });
      },
      () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
    );
  };

  providerSelect.addEventListener('change', () => {
    activeProviderId = providerSelect.value;
    createBtn.disabled = !activeProviderId;
    renderUsers(activeProviderId);
  });

  createBtn.addEventListener('click', () => openCreateUserModal(activeProviderId));

  function openCreateUserModal(providerId: string): void {
    if (!providerId) {
      tmxToast({ message: t('provisioner.selectProviderFirst'), intent: 'is-warning' });
      return;
    }
    let inputs: any;
    const content = (elem: HTMLElement) => {
      inputs = renderForm(elem, [
        { label: 'Email', field: 'email', placeholder: 'jane@example.com' },
        { label: 'External ID', field: 'externalId', placeholder: 'sso-stable-id' },
        { label: 'Phone', field: 'phone', placeholder: '+1-555-…' },
        {
          label: t('system.roles'),
          field: 'providerRole',
          options: [
            { label: 'Director', value: 'DIRECTOR' },
            { label: 'Provider Admin', value: 'PROVIDER_ADMIN' },
          ],
          value: 'DIRECTOR',
        },
        { label: 'SSO Provider', field: 'ssoProvider', value: 'ioncourt' },
      ]);
    };

    openModal({
      title: t('provisioner.createUser'),
      content,
      buttons: [
        { label: t('common.cancel'), intent: 'none', close: true },
        {
          label: t('system.create'),
          intent: 'is-primary',
          close: true,
          onClick: () => {
            const email = inputs?.email?.value?.trim();
            const externalId = inputs?.externalId?.value?.trim();
            const ssoProvider = inputs?.ssoProvider?.value?.trim() || 'ioncourt';
            const providerRole = (inputs?.providerRole?.value || 'DIRECTOR') as
              | 'PROVIDER_ADMIN'
              | 'DIRECTOR';
            const phone = inputs?.phone?.value?.trim() || undefined;

            if (!email || !externalId) {
              tmxToast({ message: t('provisioner.userFieldsRequired'), intent: 'is-warning' });
              return;
            }

            createUserAsProvisioner({ providerId, externalId, email, phone, providerRole, ssoProvider }).then(
              (res: any) => {
                if (res?.data?.error) {
                  tmxToast({ message: res.data.error, intent: 'is-danger' });
                  return;
                }
                tmxToast({ message: t('provisioner.userCreated'), intent: 'is-success' });
                renderUsers(providerId);
              },
              () => tmxToast({ message: t('system.createFailed'), intent: 'is-danger' }),
            );
          },
        },
      ],
    });
  }

  // Initial provider load
  listMyProviders().then(
    (res: any) => {
      providers = res?.data?.providers ?? [];
      for (const p of providers) {
        const opt = document.createElement('option');
        opt.value = p.providerId;
        opt.textContent = p.organisationAbbreviation
          ? `${p.organisationName} (${p.organisationAbbreviation})`
          : p.organisationName;
        providerSelect.appendChild(opt);
      }
      renderUsers('');
    },
    () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
  );
}
