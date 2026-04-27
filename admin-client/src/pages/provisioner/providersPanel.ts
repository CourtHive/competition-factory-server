import {
  listMyProviders,
  createProviderAsProvisioner,
} from 'services/apis/provisionerWorkspaceApi';
import { setActiveProvider } from 'services/provider/providerState';
import { confirmModal, openModal } from 'components/modals/baseModal/baseModal';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { destroyTable } from 'pages/tournament/destroyTable';
import { openTmxImpersonate } from 'services/openTmxImpersonate';
import { openCapsEditor } from 'components/providerConfig/openCapsEditor';
import { tmxToast } from 'services/notifications/tmxToast';
import { renderForm } from 'courthive-components';
import { t } from 'i18n';

const TABLE_ID = 'provisionerProvidersTable';

export function renderProvisionerProvidersPanel({ container }: { container: HTMLElement }): void {
  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'system-users-toolbar';

  const heading = document.createElement('div');
  heading.style.cssText = 'font-weight: 600; font-size: .9rem;';
  heading.textContent = t('provisioner.myProviders');
  toolbar.appendChild(heading);

  const actions = document.createElement('div');
  actions.className = 'toolbar-actions';
  const createBtn = document.createElement('button');
  createBtn.className = 'btn-invite';
  createBtn.textContent = t('provisioner.createProvider');
  createBtn.addEventListener('click', openCreateProviderModal);
  actions.appendChild(createBtn);
  toolbar.appendChild(actions);

  container.appendChild(toolbar);

  const tableEl = document.createElement('div');
  tableEl.id = TABLE_ID;
  tableEl.style.cssText = 'border: 1px solid var(--tmx-border-secondary); border-radius: 8px; padding: 12px;';
  container.appendChild(tableEl);

  const refresh = () => {
    listMyProviders().then(
      (res: any) => renderTable(res?.data?.providers ?? []),
      () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
    );
  };

  const renderTable = (providers: any[]) => {
    destroyTable({ anchorId: TABLE_ID });
    new Tabulator(tableEl, {
      placeholder: t('provisioner.noProviders'),
      layout: 'fitColumns',
      maxHeight: 500,
      columns: [
        { title: t('system.providerName'), field: 'organisationName', headerSort: true },
        { title: t('system.providerAbbr'), field: 'organisationAbbreviation', headerSort: true, width: 120 },
        { title: t('system.relationship'), field: 'relationship', headerSort: true, width: 120 },
        {
          title: '',
          width: 110,
          hozAlign: 'center',
          headerSort: false,
          formatter: () =>
            `<button class="btn-edit-caps" style="font-size:.7rem;padding:2px 8px;">${t('providerConfig.editCapsButton')}</button>`,
          cellClick: (_e: any, cell: any) => {
            const row = cell.getRow().getData();
            openCapsEditor({
              providerId: row.providerId,
              providerName: row.organisationName,
              onSaved: refresh,
            });
          },
        },
        {
          title: '',
          width: 140,
          hozAlign: 'center',
          headerSort: false,
          formatter: () => `<button class="btn-impersonate" style="font-size:.7rem;padding:2px 8px;">${t('provisioner.openInTmx')}</button>`,
          cellClick: (_e: any, cell: any) => {
            const row = cell.getRow().getData();
            openInTmx(row);
          },
        },
      ],
      data: providers,
    });
  };

  function openInTmx(provider: any): void {
    const providerValue = {
      organisationId: provider.providerId,
      organisationName: provider.organisationName,
      organisationAbbreviation: provider.organisationAbbreviation,
    };
    setActiveProvider(providerValue);
    void openTmxImpersonate(providerValue);
  }

  function openCreateProviderModal(): void {
    let inputs: any;
    const content = (elem: HTMLElement) => {
      inputs = renderForm(elem, [
        {
          label: t('system.providerName'),
          field: 'organisationName',
          placeholder: t('provisioner.providerNamePlaceholder'),
        },
        {
          label: t('system.providerAbbr'),
          field: 'organisationAbbreviation',
          placeholder: t('provisioner.providerAbbrPlaceholder'),
        },
      ]);
    };

    openModal({
      title: t('provisioner.createProvider'),
      content,
      buttons: [
        { label: t('common.cancel'), intent: 'none', close: true },
        {
          label: t('system.create'),
          intent: 'is-primary',
          close: true,
          onClick: () => {
            const organisationName = inputs?.organisationName?.value?.trim();
            const organisationAbbreviation = inputs?.organisationAbbreviation?.value?.trim();
            if (!organisationName || !organisationAbbreviation) {
              tmxToast({ message: t('provisioner.providerFieldsRequired'), intent: 'is-warning' });
              return;
            }
            createProviderAsProvisioner({ organisationName, organisationAbbreviation }).then(
              (res: any) => {
                if (res?.data?.error) {
                  tmxToast({ message: res.data.error, intent: 'is-danger' });
                  return;
                }
                tmxToast({ message: t('provisioner.providerCreated'), intent: 'is-success' });
                refresh();
              },
              () => tmxToast({ message: t('system.createFailed'), intent: 'is-danger' }),
            );
          },
        },
      ],
    });
  }

  // unused-but-future: confirmModal exported for follow-up edit/delete actions
  void confirmModal;

  refresh();
}
