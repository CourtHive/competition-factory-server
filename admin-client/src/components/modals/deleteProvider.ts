/**
 * Delete provider modal — DESTRUCTIVE, no archive, no recovery.
 *
 * Same blast-radius preview as archive, but stricter confirmation:
 * the user must (a) type the provider's abbreviation, AND (b) tick the
 * "I understand this cannot be undone" checkbox. The server enforces
 * both independently.
 *
 * Use case: providers with no data worth preserving — demo/test
 * providers, abandoned signups. For anything with real data, use the
 * archive modal so the result is reversible via revive-provider.mjs.
 */
import { previewArchiveProvider, deleteProviderPermanently } from 'services/apis/servicesApi';
import { tmxToast } from 'services/notifications/tmxToast';
import { openModal } from './baseModal/baseModal';
import { t } from 'i18n';

type CleanupCounts = {
  tournaments: number;
  userAssociations: number;
  provisionerAssociations: number;
  tournamentAssignments: number;
  officialRecords: number;
  sanctioningRecords: number;
  tournamentProvisioner: number;
  pendingSaves: number;
  calendars: number;
  topologies: number;
  catalogItems: number;
  policies: number;
  auditLogRows: number;
};

function rowFor(label: string, n: number): string {
  return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--tmx-border-primary,#eee);font-size:0.9rem;"><span>${label}</span><span style="font-variant-numeric:tabular-nums;font-weight:600;">${n.toLocaleString()}</span></div>`;
}

function renderCounts(counts: CleanupCounts): string {
  return [
    rowFor(t('modals.archiveProvider.counts.tournaments'), counts.tournaments),
    rowFor(t('modals.archiveProvider.counts.userAssociations'), counts.userAssociations),
    rowFor(t('modals.archiveProvider.counts.tournamentAssignments'), counts.tournamentAssignments),
    rowFor(t('modals.archiveProvider.counts.calendars'), counts.calendars),
    rowFor(t('modals.archiveProvider.counts.auditLogRows'), counts.auditLogRows),
  ].join('');
}

export function deleteProviderModal({
  providerId,
  providerAbbr,
  providerName,
  callback,
}: {
  providerId: string;
  providerAbbr: string;
  providerName: string;
  callback?: () => void;
}): void {
  let modalHandle: any;
  let confirmInput: HTMLInputElement | null = null;
  let ackCheckbox: HTMLInputElement | null = null;

  // Gate the footer submit button as the user types via cModal's own
  // setButtonState API — no DOM querying, no footer rebuild. The button's
  // click handler is passed into cModal in the buttons config below.
  const updateEnabled = () => {
    const enabled = confirmInput?.value === providerAbbr && ackCheckbox?.checked;
    modalHandle?.setButtonState('deleteProviderSubmit', { disabled: !enabled });
  };

  const content = (elem: HTMLElement) => {
    elem.innerHTML = `
      <div style="background:var(--tmx-status-error-bg,#fef2f2);border-left:4px solid var(--tmx-status-error,#dc2626);padding:10px 12px;margin-bottom:12px;border-radius:4px;font-size:0.9rem;">
        <strong>${t('modals.deleteProvider.warning')}</strong>
        <div style="margin-top:4px;color:var(--tmx-text-secondary,#64748b);">
          ${t('modals.deleteProvider.warningDetail')}
        </div>
      </div>
      <p style="margin:0 0 12px 0;font-size:0.95rem;">
        ${t('modals.deleteProvider.intro', { provider: providerName, abbr: providerAbbr })}
      </p>
      <div id="deletePreview" style="margin:8px 0 16px 0;color:var(--tmx-text-secondary,#64748b);">
        ${t('modals.archiveProvider.loading')}
      </div>
      <label style="display:block;font-size:0.9rem;margin-bottom:4px;">
        ${t('modals.archiveProvider.confirmLabel', { abbr: providerAbbr })}
      </label>
      <input id="deleteConfirmInput" type="text" autocomplete="off"
             placeholder="${providerAbbr}"
             style="width:100%;padding:8px;border:1px solid var(--tmx-border-primary,#ddd);border-radius:4px;font-family:monospace;margin-bottom:12px;" />
      <label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer;">
        <input id="deleteAckCheckbox" type="checkbox" />
        <span>${t('modals.deleteProvider.acknowledge')}</span>
      </label>
    `;

    confirmInput = elem.querySelector<HTMLInputElement>('#deleteConfirmInput');
    ackCheckbox = elem.querySelector<HTMLInputElement>('#deleteAckCheckbox');
    confirmInput?.addEventListener('input', updateEnabled);
    ackCheckbox?.addEventListener('change', updateEnabled);

    previewArchiveProvider({ providerId }).then(
      (res: any) => {
        const div = elem.querySelector('#deletePreview');
        if (div && res?.data?.counts) {
          div.innerHTML = renderCounts(res.data.counts);
        }
      },
      () => {
        const div = elem.querySelector('#deletePreview');
        if (div) {
          div.innerHTML = `<span style="color:var(--tmx-status-error,#c62828);">${t('modals.archiveProvider.previewFailed')}</span>`;
        }
      },
    );
  };

  const onSubmit = () => {
    const confirm = confirmInput?.value ?? '';
    if (confirm !== providerAbbr) return;
    deleteProviderPermanently({ providerId, confirm }).then(
      (res: any) => {
        const data = res?.data ?? {};
        tmxToast({
          message: t('modals.deleteProvider.success', {
            abbr: providerAbbr,
            tournaments: data?.counts?.tournaments ?? 0,
          }),
          intent: 'is-success',
        });
        callback?.();
      },
      (err: any) => {
        const message = err?.response?.data?.message || err?.message || t('modals.deleteProvider.failed');
        tmxToast({ message, intent: 'is-danger' });
      },
    );
  };

  modalHandle = openModal({
    title: t('modals.deleteProvider.title', { provider: providerName }),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      {
        label: t('modals.deleteProvider.submit'),
        id: 'deleteProviderSubmit',
        disabled: true,
        onClick: onSubmit,
        close: true,
        intent: 'is-danger',
      },
    ],
  });
}
