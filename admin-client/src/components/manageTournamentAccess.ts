/**
 * Manage Tournament Access — port of the TMX modal of the same name.
 *
 * Allows PROVIDER_ADMIN of the tournament's provider (or SUPER_ADMIN) to
 * grant or revoke other users' access to a specific tournament.
 *
 * Lives in admin-client (not TMX) because TMX is end-user-only — provider
 * admin work belongs in the admin app where the user is already in the
 * "managing my provider" mindset. Slotted into the TournamentDetail panel
 * on the provider admin landing.
 */
import { openModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { baseApi } from 'services/apis/baseApi';
import { t } from 'i18n';

interface ManageAccessParams {
  tournamentId: string;
  tournamentName: string;
  providerId: string;
  onRefresh?: () => void;
}

const SECTION_STYLE = 'margin-bottom: 12px;';
const LABEL_STYLE = 'font-size: .8rem; color: var(--tmx-text-secondary, #555); margin-bottom: 4px;';
const VALUE_STYLE = 'font-size: .95rem; font-weight: 500;';
const INPUT_STYLE =
  'flex: 1; padding: 4px 8px; border: 1px solid var(--tmx-border-primary, #ccc); border-radius: 4px; font-size: .85rem; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';
const ROW_STYLE =
  'display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-bottom: 1px solid var(--tmx-border-secondary, #eee);';

export function manageTournamentAccess({
  tournamentId,
  tournamentName,
  providerId,
  onRefresh,
}: ManageAccessParams) {
  let assignmentsContainer: HTMLElement;
  let addInput: HTMLInputElement;

  const content = (elem: HTMLElement) => {
    elem.innerHTML = '';

    // Owner read-only display
    const ownerSection = document.createElement('div');
    ownerSection.style.cssText = SECTION_STYLE;
    ownerSection.innerHTML = `
      <div style="${LABEL_STYLE}">${t('manageAccess.tournament')}</div>
      <div style="${VALUE_STYLE}">${tournamentName}</div>
    `;
    elem.appendChild(ownerSection);

    // Current assignments
    const assignmentsSection = document.createElement('div');
    assignmentsSection.style.cssText = SECTION_STYLE;
    const assignmentsLabel = document.createElement('div');
    assignmentsLabel.style.cssText = LABEL_STYLE;
    assignmentsLabel.textContent = t('manageAccess.grantedAccess');
    assignmentsSection.appendChild(assignmentsLabel);

    assignmentsContainer = document.createElement('div');
    assignmentsContainer.style.cssText =
      'border: 1px solid var(--tmx-border-secondary, #eee); border-radius: 4px; min-height: 40px;';
    assignmentsSection.appendChild(assignmentsContainer);
    elem.appendChild(assignmentsSection);

    // Add user section
    const addSection = document.createElement('div');
    addSection.style.cssText = SECTION_STYLE;
    const addLabel = document.createElement('div');
    addLabel.style.cssText = LABEL_STYLE;
    addLabel.textContent = t('manageAccess.addUser');
    addSection.appendChild(addLabel);

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display: flex; gap: 8px; align-items: stretch;';

    addInput = document.createElement('input');
    addInput.type = 'email';
    addInput.placeholder = t('manageAccess.emailPlaceholder');
    addInput.setAttribute('list', 'mta-users-datalist');
    addInput.style.cssText = INPUT_STYLE;

    const datalist = document.createElement('datalist');
    datalist.id = 'mta-users-datalist';

    const addButton = document.createElement('button');
    addButton.className = 'btn-invite';
    addButton.textContent = t('manageAccess.grant');
    addButton.style.cssText = 'padding: 4px 12px;';
    addButton.addEventListener('click', handleGrant);

    addRow.appendChild(addInput);
    addRow.appendChild(datalist);
    addRow.appendChild(addButton);
    addSection.appendChild(addRow);
    elem.appendChild(addSection);

    // Load data
    loadAssignments();
    loadEligibleUsers(datalist);
  };

  async function loadAssignments() {
    try {
      const result = await baseApi.post('/factory/assignments/list', { tournamentId });
      const assignments = result?.data?.assignments ?? [];
      renderAssignments(assignments);
    } catch {
      assignmentsContainer.textContent = t('manageAccess.loadError');
    }
  }

  async function loadEligibleUsers(datalist: HTMLElement) {
    try {
      const result = await baseApi.post('/factory/assignments/eligible-users', { providerId });
      const eligibleUsers = result?.data?.users ?? [];
      datalist.innerHTML = '';
      for (const user of eligibleUsers) {
        const option = document.createElement('option');
        option.value = user.email;
        option.label = `${user.email} (${user.providerRole})`;
        datalist.appendChild(option);
      }
    } catch {
      // Silent — datalist just won't have suggestions
    }
  }

  function renderAssignments(assignments: any[]) {
    assignmentsContainer.innerHTML = '';
    if (assignments.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding: 8px; color: var(--tmx-text-muted, #888); font-size: .85rem;';
      empty.textContent = t('manageAccess.noAssignments');
      assignmentsContainer.appendChild(empty);
      return;
    }
    for (const a of assignments) {
      const row = document.createElement('div');
      row.style.cssText = ROW_STYLE;

      const info = document.createElement('span');
      info.style.cssText = 'font-size: .85rem; flex: 1;';
      info.textContent = a.email || a.userId;

      const role = document.createElement('span');
      role.style.cssText = 'font-size: .75rem; color: var(--tmx-text-secondary, #555); margin: 0 8px;';
      role.textContent = a.assignmentRole;

      const revokeBtn = document.createElement('button');
      revokeBtn.className = 'btn-danger';
      revokeBtn.style.cssText = 'padding: 2px 8px; font-size: .75rem;';
      revokeBtn.textContent = t('manageAccess.revoke');
      revokeBtn.addEventListener('click', () => handleRevoke(a.email));

      row.appendChild(info);
      row.appendChild(role);
      row.appendChild(revokeBtn);
      assignmentsContainer.appendChild(row);
    }
  }

  async function handleGrant() {
    const email = addInput.value.trim();
    if (!email) return;

    try {
      const result = await baseApi.post('/factory/assignments/grant', {
        tournamentId,
        userEmail: email,
        providerId,
      });
      if (result?.data?.error) {
        tmxToast({ message: result.data.error, intent: 'is-danger' });
        return;
      }
      tmxToast({ message: t('manageAccess.granted', { email }), intent: 'is-success' });
      addInput.value = '';
      loadAssignments();
      onRefresh?.();
    } catch (err: any) {
      tmxToast({ message: err?.message || t('manageAccess.grantError'), intent: 'is-danger' });
    }
  }

  async function handleRevoke(email: string) {
    try {
      const result = await baseApi.post('/factory/assignments/revoke', {
        tournamentId,
        userEmail: email,
        providerId,
      });
      if (result?.data?.error) {
        tmxToast({ message: result.data.error, intent: 'is-danger' });
        return;
      }
      tmxToast({ message: t('manageAccess.revoked', { email }), intent: 'is-info' });
      loadAssignments();
      onRefresh?.();
    } catch (err: any) {
      tmxToast({ message: err?.message || t('manageAccess.revokeError'), intent: 'is-danger' });
    }
  }

  openModal({
    title: t('manageAccess.title'),
    content,
    config: { padding: '.75', maxWidth: 560 },
    buttons: [{ label: t('common.close'), intent: 'none', close: true }],
  });
}
