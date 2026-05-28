/**
 * Backfill nudge tile for the system › users sub-tab.
 *
 * Renders a small banner above the users table summarizing how many
 * users still lack a verified recovery mailbox. Driven by the
 * SUPER_ADMIN-only GET /account/contact-email/coverage. Failures are
 * silent — the rest of the panel still renders without the tile.
 *
 * Visual rule: if any user is missing a contact_email or has
 * contact_email = email (likely-fake), the tile renders in warning
 * style; otherwise neutral (info).
 */
import { getContactEmailCoverage, type ContactEmailCoverage } from 'services/apis/servicesApi';
import { t } from 'i18n';

export function buildContactEmailCoverageTile(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'contact-email-coverage-tile';
  root.style.cssText =
    'display:flex;align-items:center;gap:16px;padding:8px 12px;margin-bottom:12px;' +
    'border:1px solid var(--tmx-border-secondary);border-radius:6px;font-size:13px;' +
    'background:var(--tmx-bg-secondary);color:var(--tmx-text-primary);';

  const label = document.createElement('span');
  label.style.cssText = 'font-weight:600;';
  label.textContent = t('system.contactEmailCoverage.label');
  root.appendChild(label);

  const numbers = document.createElement('span');
  numbers.style.cssText = 'color:var(--tmx-text-muted);';
  numbers.textContent = t('system.contactEmailCoverage.loading');
  root.appendChild(numbers);

  getContactEmailCoverage()
    .then((res: any) => {
      const data: ContactEmailCoverage | undefined = res?.data;
      if (!data) {
        root.remove();
        return;
      }
      renderCounts(root, numbers, data);
    })
    .catch(() => {
      // SUPER_ADMIN gate or network — silent removal so non-super-admins
      // never see a broken tile.
      root.remove();
    });

  return root;
}

function renderCounts(
  root: HTMLElement,
  numbers: HTMLElement,
  data: ContactEmailCoverage,
): void {
  const needsAttention = data.missing > 0 || data.equalsLogin > 0;

  if (needsAttention) {
    root.style.background = 'var(--tmx-panel-yellow-bg)';
    root.style.borderColor = 'var(--tmx-panel-yellow-border)';
  } else {
    root.style.background = 'var(--tmx-panel-green-bg)';
    root.style.borderColor = 'var(--tmx-panel-green-border)';
  }

  numbers.innerHTML = '';
  numbers.style.color = 'var(--tmx-text-primary)';
  numbers.appendChild(buildChip(t('system.contactEmailCoverage.verified'), data.verified, 'var(--tmx-status-success)'));
  numbers.appendChild(buildChip(t('system.contactEmailCoverage.unverified'), data.unverified, 'var(--tmx-accent-orange)'));
  numbers.appendChild(buildChip(t('system.contactEmailCoverage.missing'), data.missing, needsAttention ? 'var(--tmx-status-error)' : 'var(--tmx-text-muted)'));
  numbers.appendChild(buildChip(t('system.contactEmailCoverage.equalsLogin'), data.equalsLogin, needsAttention ? 'var(--tmx-status-warning)' : 'var(--tmx-text-muted)'));

  const totalEl = document.createElement('span');
  totalEl.style.cssText = 'margin-left:auto;color:var(--tmx-text-muted);font-size:12px;';
  totalEl.textContent = t('system.contactEmailCoverage.total', { count: data.total });
  root.appendChild(totalEl);
}

function buildChip(text: string, count: number, color: string): HTMLElement {
  const chip = document.createElement('span');
  chip.style.cssText = 'display:inline-flex;align-items:baseline;gap:6px;margin-right:14px;';
  const value = document.createElement('strong');
  value.style.color = color;
  value.textContent = String(count);
  const lab = document.createElement('span');
  lab.style.color = 'var(--tmx-text-muted)';
  lab.style.fontSize = '12px';
  lab.textContent = text;
  chip.append(value, lab);
  return chip;
}
