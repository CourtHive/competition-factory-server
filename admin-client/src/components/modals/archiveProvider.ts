/**
 * Archive provider modal.
 *
 * SUPER_ADMIN-only. Two phases:
 *   1. On open: call previewArchiveProvider to get the blast-radius
 *      counts. Render them so the admin sees what's about to be
 *      destroyed.
 *   2. On submit: require the admin to type the provider's abbreviation
 *      literally. Server enforces this independently, but the client
 *      gate keeps a typo from generating an obviously-wrong request.
 */
import { previewArchiveProvider, archiveProvider } from 'services/apis/servicesApi';
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

type Preview = {
  providerId: string;
  providerAbbr: string;
  providerName: string;
  counts: CleanupCounts;
};

function rowFor(label: string, n: number): string {
  return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--tmx-border-primary,#eee);font-size:0.9rem;"><span>${label}</span><span style="font-variant-numeric:tabular-nums;font-weight:600;">${n.toLocaleString()}</span></div>`;
}

function renderCounts(counts: CleanupCounts): string {
  return [
    rowFor(t('modals.archiveProvider.counts.tournaments'), counts.tournaments),
    rowFor(t('modals.archiveProvider.counts.userAssociations'), counts.userAssociations),
    rowFor(t('modals.archiveProvider.counts.provisionerAssociations'), counts.provisionerAssociations),
    rowFor(t('modals.archiveProvider.counts.tournamentAssignments'), counts.tournamentAssignments),
    rowFor(t('modals.archiveProvider.counts.officialRecords'), counts.officialRecords),
    rowFor(t('modals.archiveProvider.counts.sanctioningRecords'), counts.sanctioningRecords),
    rowFor(t('modals.archiveProvider.counts.tournamentProvisioner'), counts.tournamentProvisioner),
    rowFor(t('modals.archiveProvider.counts.pendingSaves'), counts.pendingSaves),
    rowFor(t('modals.archiveProvider.counts.calendars'), counts.calendars),
    rowFor(t('modals.archiveProvider.counts.topologies'), counts.topologies),
    rowFor(t('modals.archiveProvider.counts.catalogItems'), counts.catalogItems),
    rowFor(t('modals.archiveProvider.counts.policies'), counts.policies),
    rowFor(t('modals.archiveProvider.counts.auditLogRows'), counts.auditLogRows),
  ].join('');
}

export function archiveProviderModal({
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
  let preview: Preview | undefined;

  const content = (elem: HTMLElement) => {
    elem.innerHTML = `
      <p style="margin:0 0 12px 0;font-size:0.95rem;">
        ${t('modals.archiveProvider.intro', { provider: providerName, abbr: providerAbbr })}
      </p>
      <div id="archivePreview" style="margin:8px 0 16px 0;color:var(--tmx-text-secondary,#64748b);">
        ${t('modals.archiveProvider.loading')}
      </div>
      <label style="display:block;font-size:0.9rem;margin-bottom:4px;">
        ${t('modals.archiveProvider.confirmLabel', { abbr: providerAbbr })}
      </label>
      <input id="archiveConfirmInput" type="text" autocomplete="off"
             placeholder="${providerAbbr}"
             style="width:100%;padding:8px;border:1px solid var(--tmx-border-primary,#ddd);border-radius:4px;font-family:monospace;" />
    `;

    const confirmInput = elem.querySelector<HTMLInputElement>('#archiveConfirmInput');
    const submitBtn = document.getElementById('archiveProviderSubmit') as HTMLButtonElement | null;
    confirmInput?.addEventListener('input', () => {
      if (submitBtn) submitBtn.disabled = confirmInput.value !== providerAbbr;
    });

    previewArchiveProvider({ providerId }).then(
      (res: any) => {
        preview = res?.data;
        const div = elem.querySelector('#archivePreview');
        if (div && preview) {
          div.innerHTML = renderCounts(preview.counts);
        }
      },
      () => {
        const div = elem.querySelector('#archivePreview');
        if (div) {
          div.innerHTML = `<span style="color:var(--tmx-status-error,#c62828);">${t('modals.archiveProvider.previewFailed')}</span>`;
        }
      },
    );
  };

  const onSubmit = () => {
    const input = document.getElementById('archiveConfirmInput') as HTMLInputElement | null;
    const confirm = input?.value ?? '';
    if (confirm !== providerAbbr) return;
    archiveProvider({ providerId, confirm }).then(
      (res: any) => {
        const data = res?.data ?? {};
        tmxToast({
          message: t('modals.archiveProvider.success', {
            abbr: providerAbbr,
            tournaments: data?.counts?.tournaments ?? 0,
            archiveId: data?.archiveId ?? '',
          }),
          intent: 'is-success',
        });
        callback?.();
      },
      (err: any) => {
        const message = err?.response?.data?.message || err?.message || t('modals.archiveProvider.failed');
        tmxToast({ message, intent: 'is-danger' });
      },
    );
  };

  openModal({
    title: t('modals.archiveProvider.title', { provider: providerName }),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      {
        label: t('modals.archiveProvider.submit'),
        id: 'archiveProviderSubmit',
        disabled: true,
        onClick: onSubmit,
        close: true,
        intent: 'is-warning',
      },
    ],
  });
}
