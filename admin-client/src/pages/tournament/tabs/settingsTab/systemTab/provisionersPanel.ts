import {
  listProvisioners,
  createProvisioner,
  updateProvisioner,
  deleteProvisioner,
  listProvisionerKeys,
  generateProvisionerKey,
  revokeProvisionerKey,
  listProvisionerProviders,
  associateProviderWithProvisioner,
  disassociateProviderFromProvisioner,
  listProvisionerRepresentatives,
  assignUserToProvisioner,
  removeUserFromProvisioner,
} from 'services/apis/provisionersApi';
import { getUsers } from 'services/apis/servicesApi';
import { generatedKeyModal } from 'components/modals/generatedKeyModal';
import { confirmModal, openModal } from 'components/modals/baseModal/baseModal';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { destroyTable } from 'pages/tournament/destroyTable';
import { tmxToast } from 'services/notifications/tmxToast';
import { renderForm } from 'courthive-components';
import { t } from 'i18n';

const PROVISIONER_LIST_TABLE = 'systemProvisionerListTable';
const PROVISIONER_KEYS_TABLE = 'systemProvisionerKeysTable';
const PROVISIONER_ASSOC_TABLE = 'systemProvisionerAssocTable';
const PROVISIONER_REPS_TABLE = 'systemProvisionerRepsTable';

type RenderProvisionersPanelParams = {
  container: HTMLElement;
  providers: any[];
};

function formatDateTime(value: string | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function renderProvisionersPanel({ container, providers }: RenderProvisionersPanelParams): void {
  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'system-users-toolbar';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = t('system.searchProvisioners');
  searchInput.style.cssText =
    'padding: 6px 10px; border: 1px solid var(--tmx-border-primary); border-radius: 4px; font-size: 0.85rem; min-width: 200px; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';

  const createBtn = document.createElement('button');
  createBtn.className = 'btn-invite';
  createBtn.textContent = t('system.createProvisioner');

  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'toolbar-actions';
  toolbarActions.appendChild(createBtn);

  toolbar.appendChild(searchInput);
  toolbar.appendChild(toolbarActions);
  container.appendChild(toolbar);

  const layout = document.createElement('div');
  layout.className = 'system-providers-layout';

  const listPane = document.createElement('div');
  listPane.className = 'system-provider-list';
  const listTableEl = document.createElement('div');
  listTableEl.id = PROVISIONER_LIST_TABLE;
  listPane.appendChild(listTableEl);

  const detailPane = document.createElement('div');
  detailPane.className = 'system-provider-detail';
  detailPane.innerHTML = `<div class="system-no-selection">${t('system.selectProvisioner')}</div>`;

  layout.appendChild(listPane);
  layout.appendChild(detailPane);
  container.appendChild(layout);

  let listTable: any;

  const refresh = (selectId?: string) => {
    listProvisioners().then(
      (res: any) => {
        const provisioners = res?.data?.provisioners ?? [];
        renderListTable(provisioners, selectId);
      },
      () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
    );
  };

  const renderListTable = (provisioners: any[], selectId?: string) => {
    const data = provisioners.map((p: any) => ({
      provisionerId: p.provisionerId,
      name: p.name,
      isActive: p.isActive ? t('system.active') : t('system.inactive'),
      createdAt: p.createdAt,
      _raw: p,
      searchText: `${p.name ?? ''}`.toLowerCase(),
    }));

    destroyTable({ anchorId: PROVISIONER_LIST_TABLE });
    listTable = new Tabulator(listTableEl, {
      placeholder: t('system.noProvisioners'),
      selectableRows: 1,
      layout: 'fitColumns',
      maxHeight: 500,
      columns: [
        { title: t('system.provisionerName'), field: 'name', headerSort: true },
        { title: t('system.status'), field: 'isActive', headerSort: true, width: 100 },
        {
          title: t('system.createdAt'),
          field: 'createdAt',
          headerSort: true,
          formatter: (cell: any) => formatDateTime(cell.getValue()),
        },
      ],
      data,
    });

    listTable.on('rowSelectionChanged', (_data: any, rows: any[]) => {
      const selected = rows?.[0]?.getData();
      if (selected) {
        renderProvisionerDetail(selected._raw);
      } else {
        detailPane.innerHTML = `<div class="system-no-selection">${t('system.selectProvisioner')}</div>`;
      }
    });

    if (selectId) {
      listTable.on('tableBuilt', () => {
        const row = listTable.getRows().find((r: any) => r.getData().provisionerId === selectId);
        row?.select();
      });
    }
  };

  const renderProvisionerDetail = (provisioner: any) => {
    detailPane.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'system-detail-header';
    header.innerHTML = `
      <h3>${provisioner.name}</h3>
      <div class="detail-meta">${provisioner.provisionerId} · ${provisioner.isActive ? t('system.active') : t('system.inactive')}</div>
    `;
    detailPane.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'system-detail-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = t('system.editProvisioner');
    editBtn.addEventListener('click', () => openEditProvisionerModal(provisioner));
    actions.appendChild(editBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = provisioner.isActive ? 'btn-remove' : 'btn-impersonate';
    toggleBtn.textContent = provisioner.isActive ? t('system.deactivate') : t('system.activate');
    toggleBtn.addEventListener('click', () => {
      const next = !provisioner.isActive;
      confirmModal({
        title: next ? t('system.activateProvisioner') : t('system.deactivateProvisioner'),
        query: next ? t('system.activateConfirm', { name: provisioner.name }) : t('system.deactivateConfirm', { name: provisioner.name }),
        okIntent: next ? 'is-primary' : 'is-warning',
        okAction: () => {
          updateProvisioner(provisioner.provisionerId, { isActive: next }).then(
            () => {
              tmxToast({ message: t('system.updated'), intent: 'is-success' });
              refresh(provisioner.provisionerId);
            },
            () => tmxToast({ message: t('system.updateFailed'), intent: 'is-danger' }),
          );
        },
        cancelAction: undefined,
      });
    });
    actions.appendChild(toggleBtn);

    // Permanent delete is gated to !isActive — server enforces this too,
    // but hiding the button when active prevents an obviously-wrong click.
    if (!provisioner.isActive) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-remove';
      deleteBtn.textContent = t('system.deleteProvisioner');
      deleteBtn.addEventListener('click', () => openDeleteProvisionerModal(provisioner));
      actions.appendChild(deleteBtn);
    }

    detailPane.appendChild(actions);

    detailPane.appendChild(buildKeysSection(provisioner));
    detailPane.appendChild(buildAssociatedProvidersSection(provisioner));
    detailPane.appendChild(buildRepresentativesSection(provisioner));
  };

  const buildKeysSection = (provisioner: any): HTMLElement => {
    const section = document.createElement('div');
    section.className = 'system-associated-users';

    const sectionHeader = document.createElement('div');
    sectionHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
    sectionHeader.innerHTML = `<h4 style="margin: 0;">${t('system.apiKeys')}</h4>`;

    const generateBtn = document.createElement('button');
    generateBtn.className = 'btn-invite';
    generateBtn.style.fontSize = '0.75rem';
    generateBtn.textContent = t('system.generateKey');
    generateBtn.addEventListener('click', () => openGenerateKeyModal(provisioner));
    sectionHeader.appendChild(generateBtn);

    section.appendChild(sectionHeader);

    const tableEl = document.createElement('div');
    tableEl.id = PROVISIONER_KEYS_TABLE;
    section.appendChild(tableEl);

    listProvisionerKeys(provisioner.provisionerId).then(
      (res: any) => {
        const keys = res?.data?.keys ?? [];
        const data = keys.map((k: any) => ({
          ...k,
          status: k.isActive ? t('system.active') : t('system.revoked'),
        }));
        destroyTable({ anchorId: PROVISIONER_KEYS_TABLE });
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
              formatter: (cell: any) => (cell.getRow().getData().isActive ? `<button class="btn-remove" style="font-size:.7rem;padding:2px 8px;">${t('system.revoke')}</button>` : ''),
              cellClick: (_e: any, cell: any) => {
                const row = cell.getRow().getData();
                if (!row.isActive) return;
                confirmModal({
                  title: t('system.revokeKey'),
                  query: t('system.revokeKeyConfirm', { label: row.label || row.keyId }),
                  okIntent: 'is-warning',
                  okAction: () => {
                    revokeProvisionerKey(provisioner.provisionerId, row.keyId).then(
                      () => {
                        tmxToast({ message: t('system.keyRevoked'), intent: 'is-success' });
                        renderProvisionerDetail(provisioner);
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
  };

  const buildRepresentativesSection = (provisioner: any): HTMLElement => {
    const section = document.createElement('div');
    section.className = 'system-associated-users';

    const sectionHeader = document.createElement('div');
    sectionHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
    sectionHeader.innerHTML = `<h4 style="margin: 0;">${t('system.representatives')}</h4>`;

    const assignBtn = document.createElement('button');
    assignBtn.className = 'btn-invite';
    assignBtn.style.fontSize = '0.75rem';
    assignBtn.textContent = t('system.assignUser');
    assignBtn.addEventListener('click', () => openAssignUserModal(provisioner));
    sectionHeader.appendChild(assignBtn);

    section.appendChild(sectionHeader);

    const tableEl = document.createElement('div');
    tableEl.id = PROVISIONER_REPS_TABLE;
    section.appendChild(tableEl);

    Promise.all([listProvisionerRepresentatives(provisioner.provisionerId), getUsers()]).then(
      ([repsRes, usersRes]: any) => {
        const reps = repsRes?.data?.users ?? [];
        const usersData = usersRes?.data?.users ?? [];
        const userById = new Map<string, any>(
          usersData.map((u: any) => [u.value?.userId ?? u.key, u.value ?? u]),
        );

        const data = reps.map((r: any) => {
          const u = userById.get(r.userId);
          const firstName = u?.firstName ?? '';
          const lastName = u?.lastName ?? '';
          return {
            userId: r.userId,
            email: u?.email ?? r.userId,
            displayName: `${firstName} ${lastName}`.trim() || u?.email || r.userId,
            createdAt: r.createdAt,
          };
        });

        destroyTable({ anchorId: PROVISIONER_REPS_TABLE });
        const repsTable = new Tabulator(tableEl, {
          placeholder: t('system.noRepresentatives'),
          layout: 'fitColumns',
          maxHeight: 300,
          columns: [
            { title: t('system.displayName'), field: 'displayName', headerSort: true },
            { title: 'Email', field: 'email', headerSort: true },
            {
              title: t('system.granted'),
              field: 'createdAt',
              headerSort: true,
              formatter: (cell: any) => formatDateTime(cell.getValue()),
            },
            {
              title: '',
              width: 100,
              hozAlign: 'center',
              headerSort: false,
              formatter: () => `<button class="btn-remove" style="font-size:.7rem;padding:2px 8px;">${t('system.remove')}</button>`,
              cellClick: (_e: any, cell: any) => {
                const row = cell.getRow().getData();
                confirmModal({
                  title: t('system.removeRepresentative'),
                  query: t('system.removeRepresentativeConfirm', { email: row.email }),
                  okIntent: 'is-warning',
                  okAction: () => {
                    removeUserFromProvisioner(provisioner.provisionerId, row.userId).then(
                      () => {
                        tmxToast({ message: t('system.representativeRemoved'), intent: 'is-success' });
                        renderProvisionerDetail(provisioner);
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
        void repsTable;
      },
      () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
    );

    return section;
  };

  const openAssignUserModal = (provisioner: any) => {
    const values = { email: '' };

    getUsers().then((res: any) => {
      const usersData = res?.data?.users ?? [];
      const userList = usersData
        .map((u: any) => {
          const v = u.value ?? u;
          const name = `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim();
          return {
            label: name ? `${name} (${v.email})` : v.email,
            value: v.email,
          };
        })
        .filter((opt: any) => opt.value);

      const content = (elem: HTMLElement) => {
        renderForm(elem, [
          {
            typeAhead: { list: userList, callback: (email: string) => (values.email = email) },
            label: t('system.user'),
            placeholder: t('system.searchUsers'),
            field: 'email',
          },
        ]);
      };

      openModal({
        title: t('system.assignUser'),
        content,
        buttons: [
          { label: t('common.cancel'), intent: 'none', close: true },
          {
            label: t('system.assign'),
            intent: 'is-primary',
            close: true,
            onClick: () => {
              if (!values.email) {
                tmxToast({ message: t('system.selectUserFirst'), intent: 'is-warning' });
                return;
              }
              assignUserToProvisioner(provisioner.provisionerId, { email: values.email }).then(
                (resp: any) => {
                  if (resp?.data?.error) {
                    tmxToast({ message: resp.data.error, intent: 'is-danger' });
                    return;
                  }
                  tmxToast({ message: t('system.representativeAssigned'), intent: 'is-success' });
                  renderProvisionerDetail(provisioner);
                },
                () => tmxToast({ message: t('system.updateFailed'), intent: 'is-danger' }),
              );
            },
          },
        ],
      });
    });
  };

  const buildAssociatedProvidersSection = (provisioner: any): HTMLElement => {
    const section = document.createElement('div');
    section.className = 'system-associated-users';

    const sectionHeader = document.createElement('div');
    sectionHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
    sectionHeader.innerHTML = `<h4 style="margin: 0;">${t('system.associatedProviders')}</h4>`;

    const associateBtn = document.createElement('button');
    associateBtn.className = 'btn-invite';
    associateBtn.style.fontSize = '0.75rem';
    associateBtn.textContent = t('system.associateProvider');
    associateBtn.addEventListener('click', () => openAssociateProviderModal(provisioner));
    sectionHeader.appendChild(associateBtn);

    section.appendChild(sectionHeader);

    const tableEl = document.createElement('div');
    tableEl.id = PROVISIONER_ASSOC_TABLE;
    section.appendChild(tableEl);

    listProvisionerProviders(provisioner.provisionerId).then(
      (res: any) => {
        const associated = res?.data?.providers ?? [];
        destroyTable({ anchorId: PROVISIONER_ASSOC_TABLE });
        const assocTable = new Tabulator(tableEl, {
          placeholder: t('system.noAssociatedProviders'),
          layout: 'fitColumns',
          maxHeight: 300,
          columns: [
            { title: t('system.providerName'), field: 'organisationName', headerSort: true },
            { title: t('system.providerAbbr'), field: 'organisationAbbreviation', headerSort: true, width: 120 },
            { title: t('system.relationship'), field: 'relationship', headerSort: true, width: 120 },
            {
              title: '',
              width: 110,
              hozAlign: 'center',
              headerSort: false,
              formatter: () => `<button class="btn-remove" style="font-size:.7rem;padding:2px 8px;">${t('system.disassociate')}</button>`,
              cellClick: (_e: any, cell: any) => {
                const row = cell.getRow().getData();
                confirmModal({
                  title: t('system.disassociateProvider'),
                  query: t('system.disassociateConfirm', { name: row.organisationName }),
                  okIntent: 'is-warning',
                  okAction: () => {
                    disassociateProviderFromProvisioner(provisioner.provisionerId, row.providerId).then(
                      () => {
                        tmxToast({ message: t('system.disassociated'), intent: 'is-success' });
                        renderProvisionerDetail(provisioner);
                      },
                      () => tmxToast({ message: t('system.updateFailed'), intent: 'is-danger' }),
                    );
                  },
                  cancelAction: undefined,
                });
              },
            },
          ],
          data: associated,
        });
        void assocTable;
      },
      () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
    );

    return section;
  };

  const openDeleteProvisionerModal = (provisioner: any) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: .75rem;';

    const warn = document.createElement('div');
    warn.style.cssText =
      'background: var(--tmx-panel-red-bg, #fff8e1); border: 1px solid var(--tmx-accent-red, #f14668); padding: .6rem .75rem; border-radius: 4px; font-size: .85rem;';
    warn.innerHTML = t('system.deleteProvisionerWarning', { name: provisioner.name });
    wrap.appendChild(warn);

    const prompt = document.createElement('div');
    prompt.style.cssText = 'font-size: .85rem;';
    prompt.innerHTML = t('system.typeNameToConfirm', { name: `<strong>${provisioner.name}</strong>` });
    wrap.appendChild(prompt);

    const confirmInput = document.createElement('input');
    confirmInput.type = 'text';
    confirmInput.className = 'input';
    confirmInput.placeholder = provisioner.name;
    confirmInput.style.cssText = 'width: 100%;';
    wrap.appendChild(confirmInput);

    const content = (elem: HTMLElement) => {
      elem.appendChild(wrap);
      // Disable the destructive button until the typed name matches exactly.
      setTimeout(() => {
        const deleteBtn = document.getElementById('confirmDeleteProvisioner') as HTMLButtonElement | null;
        if (deleteBtn) deleteBtn.disabled = true;
        confirmInput.addEventListener('input', () => {
          if (deleteBtn) deleteBtn.disabled = confirmInput.value !== provisioner.name;
        });
        confirmInput.focus();
      }, 0);
    };

    openModal({
      title: t('system.deleteProvisioner'),
      content,
      buttons: [
        { label: t('common.cancel'), intent: 'none', close: true },
        {
          label: t('system.deletePermanently'),
          intent: 'is-danger',
          id: 'confirmDeleteProvisioner',
          disabled: true,
          close: true,
          onClick: () => {
            if (confirmInput.value !== provisioner.name) return;
            deleteProvisioner(provisioner.provisionerId).then(
              (res: any) => {
                if (res?.data?.error) {
                  tmxToast({ message: res.data.error, intent: 'is-danger' });
                  return;
                }
                const counts = res?.data?.cascadeCounts ?? { apiKeys: 0, providerAssociations: 0, tournamentStamps: 0 };
                tmxToast({
                  message: t('system.provisionerDeleted', counts as any),
                  intent: 'is-success',
                });
                refresh();
                detailPane.innerHTML = `<div class="system-no-selection">${t('system.selectProvisioner')}</div>`;
              },
              () => tmxToast({ message: t('system.deleteFailed'), intent: 'is-danger' }),
            );
          },
        },
      ],
    });
  };

  const openCreateProvisionerModal = () => {
    let inputs: any;
    const content = (elem: HTMLElement) => {
      inputs = renderForm(elem, [
        {
          label: t('system.provisionerName'),
          field: 'name',
          placeholder: t('system.provisionerNamePlaceholder'),
        },
      ]);
    };

    openModal({
      title: t('system.createProvisioner'),
      content,
      buttons: [
        { label: t('common.cancel'), intent: 'none', close: true },
        {
          label: t('system.create'),
          intent: 'is-primary',
          close: true,
          onClick: () => {
            const name = inputs?.name?.value?.trim();
            if (!name) {
              tmxToast({ message: t('system.nameRequired'), intent: 'is-warning' });
              return;
            }
            createProvisioner({ name }).then(
              (res: any) => {
                if (res?.data?.error) {
                  tmxToast({ message: res.data.error, intent: 'is-danger' });
                  return;
                }
                const created = res?.data?.provisioner;
                tmxToast({ message: t('system.provisionerCreated'), intent: 'is-success' });
                refresh(created?.provisionerId);
              },
              () => tmxToast({ message: t('system.createFailed'), intent: 'is-danger' }),
            );
          },
        },
      ],
    });
  };

  const openEditProvisionerModal = (provisioner: any) => {
    let inputs: any;
    const content = (elem: HTMLElement) => {
      inputs = renderForm(elem, [
        {
          label: t('system.provisionerName'),
          field: 'name',
          value: provisioner.name,
        },
      ]);
    };

    openModal({
      title: t('system.editProvisioner'),
      content,
      buttons: [
        { label: t('common.cancel'), intent: 'none', close: true },
        {
          label: t('common.save'),
          intent: 'is-primary',
          close: true,
          onClick: () => {
            const name = inputs?.name?.value?.trim();
            if (!name) {
              tmxToast({ message: t('system.nameRequired'), intent: 'is-warning' });
              return;
            }
            updateProvisioner(provisioner.provisionerId, { name }).then(
              () => {
                tmxToast({ message: t('system.updated'), intent: 'is-success' });
                refresh(provisioner.provisionerId);
              },
              () => tmxToast({ message: t('system.updateFailed'), intent: 'is-danger' }),
            );
          },
        },
      ],
    });
  };

  const openGenerateKeyModal = (provisioner: any) => {
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
            generateProvisionerKey(provisioner.provisionerId, label).then(
              (res: any) => {
                const apiKey = res?.data?.apiKey;
                if (!apiKey) {
                  tmxToast({ message: t('system.generateFailed'), intent: 'is-danger' });
                  return;
                }
                generatedKeyModal({ apiKey, label, provisionerName: provisioner.name });
                renderProvisionerDetail(provisioner);
              },
              () => tmxToast({ message: t('system.generateFailed'), intent: 'is-danger' }),
            );
          },
        },
      ],
    });
  };

  const openAssociateProviderModal = (provisioner: any) => {
    const providerList = (providers ?? [])
      .map((p: any) => ({
        label: p.value?.organisationName || p.value?.organisationAbbreviation || p.key,
        value: p.value?.organisationId || p.key,
      }))
      .filter((opt: any) => opt.value);

    const values = { providerId: '', relationship: 'owner' as 'owner' | 'subsidiary' };

    const content = (elem: HTMLElement) => {
      renderForm(elem, [
        {
          typeAhead: { list: providerList, callback: (id: string) => (values.providerId = id) },
          label: t('system.provider'),
          placeholder: t('system.searchProviders'),
          field: 'providerId',
        },
        {
          label: t('system.relationship'),
          field: 'relationship',
          options: [
            { label: t('system.owner'), value: 'owner' },
            { label: t('system.subsidiary'), value: 'subsidiary' },
          ],
          value: 'owner',
          onInput: (e: Event) => (values.relationship = (e.target as HTMLSelectElement).value as any),
        },
      ]);
    };

    openModal({
      title: t('system.associateProvider'),
      content,
      buttons: [
        { label: t('common.cancel'), intent: 'none', close: true },
        {
          label: t('system.associate'),
          intent: 'is-primary',
          close: true,
          onClick: () => {
            if (!values.providerId) {
              tmxToast({ message: t('system.selectProviderFirst'), intent: 'is-warning' });
              return;
            }
            associateProviderWithProvisioner(provisioner.provisionerId, {
              providerId: values.providerId,
              relationship: values.relationship,
            }).then(
              () => {
                tmxToast({ message: t('system.associated'), intent: 'is-success' });
                renderProvisionerDetail(provisioner);
              },
              () => tmxToast({ message: t('system.updateFailed'), intent: 'is-danger' }),
            );
          },
        },
      ],
    });
  };

  createBtn.addEventListener('click', openCreateProvisionerModal);

  searchInput.addEventListener('input', (e: any) => {
    if (!listTable) return;
    const value = (e.target.value || '').toLowerCase();
    if (value) {
      listTable.setFilter('searchText', 'like', value);
    } else {
      listTable.clearFilter(true);
    }
  });

  refresh();
}
