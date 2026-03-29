const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'var(--tmx-bg-tertiary, #e0e0e0)', text: 'var(--tmx-text-secondary, #666)' },
  SUBMITTED: { bg: 'var(--tmx-accent-blue, #4a90d9)', text: '#fff' },
  UNDER_REVIEW: { bg: 'var(--tmx-accent-orange, #f5a623)', text: '#fff' },
  APPROVED: { bg: 'var(--tmx-accent-green, #48c774)', text: '#fff' },
  CONDITIONALLY_APPROVED: { bg: 'var(--tmx-accent-yellow, #ffdd57)', text: '#333' },
  REJECTED: { bg: 'var(--tmx-accent-red, #ff6b6b)', text: '#fff' },
  WITHDRAWN: { bg: 'var(--tmx-bg-tertiary, #e0e0e0)', text: 'var(--tmx-text-tertiary, #999)' },
  MODIFICATION_REQUESTED: { bg: 'var(--tmx-accent-purple, #b86bff)', text: '#fff' },
  ACTIVE: { bg: 'var(--tmx-accent-green, #48c774)', text: '#fff' },
  POST_EVENT: { bg: 'var(--tmx-accent-blue, #4a90d9)', text: '#fff' },
  CLOSED: { bg: 'var(--tmx-bg-tertiary, #ccc)', text: 'var(--tmx-text-secondary, #666)' },
  ISSUES_FLAGGED: { bg: 'var(--tmx-accent-red, #ff6b6b)', text: '#fff' },
};

export function createStatusBadge(status: string): HTMLSpanElement {
  const badge = document.createElement('span');
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT;

  badge.textContent = status.replace(/_/g, ' ');
  badge.style.cssText = `
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75em;
    font-weight: 600;
    letter-spacing: 0.02em;
    background: ${colors.bg};
    color: ${colors.text};
    white-space: nowrap;
  `;

  return badge;
}

export function statusBadgeFormatter(_cell: any): string {
  const status = _cell.getValue();
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT;
  const label = status.replace(/_/g, ' ');
  return `<span style="
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75em;
    font-weight: 600;
    background: ${colors.bg};
    color: ${colors.text};
    white-space: nowrap;
  ">${label}</span>`;
}
