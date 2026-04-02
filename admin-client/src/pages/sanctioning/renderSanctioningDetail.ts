import { showTMXsanctioning } from 'services/transitions/screenSlaver';
import { removeAllChildNodes } from 'services/dom/transformers';
import { getSanctioningRecord, executeSanctioningMethod } from 'services/apis/sanctioningApi';
import { createStatusBadge } from './components/statusBadge';
import { confirmModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { context } from 'services/context';

import { TMX_SANCTIONING, SANCTIONING } from 'constants/tmxConstants';

const DESTRUCTIVE_METHODS = ['withdrawApplication', 'rejectApplication', 'flagComplianceIssues'];
const METHODS_NEEDING_REASON = ['rejectApplication', 'requestModification', 'flagComplianceIssues'];

export async function renderSanctioningDetail(sanctioningId?: string): Promise<void> {
  showTMXsanctioning();

  const container = document.getElementById(TMX_SANCTIONING);
  if (!container) return;
  removeAllChildNodes(container);

  if (!sanctioningId) {
    container.textContent = 'No sanctioning ID provided';
    return;
  }

  // Loading state
  const loading = document.createElement('div');
  loading.textContent = 'Loading...';
  loading.style.cssText = 'padding: 40px; text-align: center; color: var(--tmx-text-tertiary, #999);';
  container.appendChild(loading);

  try {
    const response: any = await getSanctioningRecord({ sanctioningId });
    const record = response?.data?.sanctioningRecord;
    if (!record) {
      container.textContent = 'Sanctioning record not found';
      return;
    }

    removeAllChildNodes(container);
    renderDetailContent(container, record);
  } catch {
    removeAllChildNodes(container);
    container.textContent = 'Failed to load sanctioning record';
  }
}

function renderDetailContent(container: HTMLElement, record: any): void {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding: 16px 20px; max-width: 1000px;';

  // Header with back button
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; align-items: center; gap: 16px; margin-bottom: 20px;';

  const backBtn = document.createElement('button');
  backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
  backBtn.style.cssText = 'padding: 6px 10px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; cursor: pointer; background: transparent;';
  backBtn.addEventListener('click', () => context.router?.navigate(`/${SANCTIONING}`));

  const titleEl = document.createElement('h2');
  titleEl.textContent = record.proposal?.tournamentName ?? 'Untitled';
  titleEl.style.cssText = 'margin: 0; font-size: 1.3em; font-weight: 600; flex: 1;';

  header.appendChild(backBtn);
  header.appendChild(titleEl);
  header.appendChild(createStatusBadge(record.status));
  wrapper.appendChild(header);

  // Info grid
  const grid = document.createElement('div');
  grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 20px;';

  // Status panel
  grid.appendChild(
    createPanel('Status & Workflow', [
      ['Status', record.status],
      ['Version', `${record.version}`],
      ['Created', formatDate(record.createdAt)],
      ['Submitted', formatDate(record.submittedAt)],
      ['Approved', formatDate(record.approvedAt)],
      ['Level', record.sanctioningLevel || '—'],
      ['Governing Body', record.governingBodyId],
    ]),
  );

  // Proposal panel
  grid.appendChild(
    createPanel('Proposal', [
      ['Tournament', record.proposal?.tournamentName],
      ['Dates', `${record.proposal?.proposedStartDate ?? ''} — ${record.proposal?.proposedEndDate ?? ''}`],
      ['Country', record.proposal?.hostCountryCode || '—'],
      ['Surface', record.proposal?.surfaceCategory || '—'],
      ['Indoor/Outdoor', record.proposal?.indoorOutdoor || '—'],
      ['Events', `${record.proposal?.events?.length ?? 0} event(s)`],
    ]),
  );

  // Applicant panel
  grid.appendChild(
    createPanel('Applicant', [
      ['Organisation', record.applicant?.organisationName || '—'],
      ['Contact', record.applicant?.contactName || '—'],
      ['Email', record.applicant?.contactEmail || '—'],
    ]),
  );

  // Endorsement panel (if exists)
  if (record.endorsement) {
    grid.appendChild(
      createPanel('Endorsement', [
        ['Status', record.endorsement.status],
        ['Endorser', record.endorsement.endorserName || '—'],
        ['Endorsed At', formatDate(record.endorsement.endorsedAt)],
        ['Notes', record.endorsement.endorserNotes || '—'],
      ]),
    );
  }

  wrapper.appendChild(grid);

  // Events table
  if (record.proposal?.events?.length) {
    const eventsSection = document.createElement('div');
    eventsSection.style.cssText = 'margin-bottom: 20px;';

    const eventsTitle = document.createElement('h3');
    eventsTitle.textContent = 'Events';
    eventsTitle.style.cssText = 'margin: 0 0 8px; font-size: 1em; font-weight: 600;';
    eventsSection.appendChild(eventsTitle);

    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 8px;';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr style="background: var(--tmx-bg-secondary, #f5f5f5); border-bottom: 1px solid var(--tmx-border-primary, #ddd);">
      <th style="padding: 8px 12px; text-align: left; font-size: 0.85em;">Name</th>
      <th style="padding: 8px 12px; text-align: left; font-size: 0.85em;">Type</th>
      <th style="padding: 8px 12px; text-align: left; font-size: 0.85em;">Gender</th>
      <th style="padding: 8px 12px; text-align: left; font-size: 0.85em;">Draw Size</th>
      <th style="padding: 8px 12px; text-align: left; font-size: 0.85em;">Draw Type</th>
      <th style="padding: 8px 12px; text-align: left; font-size: 0.85em;">Format</th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const event of record.proposal.events) {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom: 1px solid var(--tmx-border-secondary, #eee);';
      tr.innerHTML = `
        <td style="padding: 8px 12px; font-size: 0.85em;">${event.eventName || ''}</td>
        <td style="padding: 8px 12px; font-size: 0.85em;">${event.eventType || ''}</td>
        <td style="padding: 8px 12px; font-size: 0.85em;">${event.gender || ''}</td>
        <td style="padding: 8px 12px; font-size: 0.85em;">${event.drawSize || ''}</td>
        <td style="padding: 8px 12px; font-size: 0.85em;">${event.drawType || ''}</td>
        <td style="padding: 8px 12px; font-size: 0.85em;">${event.matchUpFormat || ''}</td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    eventsSection.appendChild(table);
    wrapper.appendChild(eventsSection);
  }

  // Status history
  if (record.statusHistory?.length) {
    const historySection = document.createElement('div');
    historySection.style.cssText = 'margin-bottom: 20px;';

    const historyTitle = document.createElement('h3');
    historyTitle.textContent = 'Status History';
    historyTitle.style.cssText = 'margin: 0 0 8px; font-size: 1em; font-weight: 600;';
    historySection.appendChild(historyTitle);

    for (const transition of record.statusHistory) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 12px; align-items: center; padding: 4px 0; font-size: 0.85em;';

      const date = document.createElement('span');
      date.textContent = formatDate(transition.transitionedAt);
      date.style.cssText = 'color: var(--tmx-text-tertiary, #999); min-width: 140px;';

      const arrow = document.createElement('span');
      arrow.textContent = `${transition.fromStatus} → ${transition.toStatus}`;
      arrow.style.fontWeight = '500';

      row.appendChild(date);
      row.appendChild(arrow);

      if (transition.reason) {
        const reason = document.createElement('span');
        reason.textContent = `— ${transition.reason}`;
        reason.style.color = 'var(--tmx-text-secondary, #666)';
        row.appendChild(reason);
      }

      historySection.appendChild(row);
    }

    wrapper.appendChild(historySection);
  }

  // Action buttons based on status
  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid var(--tmx-border-primary, #ddd);';

  const actionMap: Record<string, Array<{ label: string; method: string; className: string; params?: any }>> = {
    DRAFT: [{ label: 'Edit', method: 'edit', className: 'btn-edit' }],
    SUBMITTED: [
      { label: 'Begin Review', method: 'reviewApplication', className: 'btn-edit' },
      { label: 'Withdraw', method: 'withdrawApplication', className: 'btn-remove' },
    ],
    UNDER_REVIEW: [
      { label: 'Approve', method: 'approveApplication', className: 'btn-edit' },
      { label: 'Reject', method: 'rejectApplication', className: 'btn-remove' },
      { label: 'Request Modifications', method: 'requestModification', className: 'btn-impersonate' },
    ],
    APPROVED: [
      { label: 'Activate (Create Tournament)', method: 'activateFromSanctioning', className: 'btn-invite' },
      { label: 'Withdraw', method: 'withdrawApplication', className: 'btn-remove' },
    ],
    ACTIVE: [
      { label: 'Mark Post-Event', method: 'transitionToPostEvent', className: 'btn-edit' },
    ],
    POST_EVENT: [
      { label: 'Close', method: 'closeApplication', className: 'btn-edit' },
      { label: 'Flag Issues', method: 'flagComplianceIssues', className: 'btn-remove' },
    ],
    ISSUES_FLAGGED: [
      { label: 'Close', method: 'closeApplication', className: 'btn-edit' },
    ],
  };

  const availableActions = actionMap[record.status] ?? [];
  for (const action of availableActions) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.className = action.className;
    btn.setAttribute('aria-label', action.label);
    btn.style.cssText = 'padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; color: #fff; font-weight: 500;';

    if (action.method === 'edit') {
      // Navigate to wizard with existing record ID for editing
      btn.addEventListener('click', () => {
        context.router?.navigate(`/${SANCTIONING}/${record.sanctioningId}`);
        // TODO: wire renderSanctioningWizard to load existing record when ID is provided
      });
    } else {
      btn.addEventListener('click', () => {
        const isDestructive = DESTRUCTIVE_METHODS.includes(action.method);
        const needsReason = METHODS_NEEDING_REASON.includes(action.method);

        const executeAction = async (reason?: string) => {
          btn.disabled = true;
          const originalText = btn.textContent;
          btn.textContent = 'Processing...';
          btn.style.opacity = '0.6';

          try {
            const params: any = { ...(action.params ?? {}) };
            if (reason) params.reason = reason;

            const response: any = await executeSanctioningMethod({
              sanctioningId: record.sanctioningId,
              method: action.method,
              params,
            });

            if (response?.data?.error) {
              const msg = response.data.error.message || response.data.error.code || 'Operation failed';
              tmxToast({ message: `${action.label}: ${msg}`, intent: 'is-danger' });
            } else {
              tmxToast({ message: `${action.label} successful`, intent: 'is-success' });
              renderSanctioningDetail(record.sanctioningId);
            }
          } catch (err: any) {
            const msg = err?.response?.data?.error?.message || err?.message || 'Network error';
            tmxToast({ message: `${action.label} failed: ${msg}`, intent: 'is-danger' });
          } finally {
            btn.disabled = false;
            btn.textContent = originalText;
            btn.style.opacity = '1';
          }
        };

        if (isDestructive || needsReason) {
          // Show confirmation dialog
          const dialogContent = document.createElement('div');
          const message = document.createElement('p');
          message.textContent = `Are you sure you want to ${action.label.toLowerCase()}?`;
          message.style.marginBottom = '12px';
          dialogContent.appendChild(message);

          let reasonInput: HTMLTextAreaElement | undefined;
          if (needsReason) {
            const label = document.createElement('label');
            label.textContent = 'Reason (required for this action):';
            label.style.cssText = 'display: block; font-size: 0.85em; margin-bottom: 4px;';
            dialogContent.appendChild(label);

            reasonInput = document.createElement('textarea');
            reasonInput.rows = 3;
            reasonInput.placeholder = 'Enter reason...';
            reasonInput.setAttribute('aria-label', 'Reason for action');
            reasonInput.style.cssText = 'width: 100%; padding: 8px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; box-sizing: border-box; resize: vertical;';
            dialogContent.appendChild(reasonInput);
          }

          confirmModal({
            title: `Confirm: ${action.label}`,
            query: dialogContent,
            cancelAction: undefined,
            okIntent: isDestructive ? 'is-danger' : 'is-warning',
            okAction: () => {
              const reason = reasonInput?.value?.trim();
              if (needsReason && !reason) {
                tmxToast({ message: 'A reason is required for this action', intent: 'is-warning' });
                return;
              }
              executeAction(reason);
            },
          });
        } else {
          executeAction();
        }
      });
    }
    actions.appendChild(btn);
  }

  wrapper.appendChild(actions);
  container.appendChild(wrapper);
}

function createPanel(title: string, items: [string, string | undefined][]): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 8px; overflow: hidden;';

  const header = document.createElement('div');
  header.textContent = title;
  header.style.cssText = 'padding: 8px 12px; background: var(--tmx-bg-secondary, #f5f5f5); font-weight: 600; font-size: 0.9em; border-bottom: 1px solid var(--tmx-border-primary, #ddd);';
  panel.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'padding: 8px 0;';

  for (const [key, val] of items) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; padding: 3px 12px; font-size: 0.85em;';

    const keyEl = document.createElement('span');
    keyEl.textContent = key;
    keyEl.style.cssText = 'min-width: 100px; color: var(--tmx-text-secondary, #666); font-weight: 500;';

    const valEl = document.createElement('span');
    valEl.textContent = val ?? '—';

    row.appendChild(keyEl);
    row.appendChild(valEl);
    body.appendChild(row);
  }

  panel.appendChild(body);
  return panel;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}
