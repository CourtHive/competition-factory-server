/**
 * One-shot API key reveal.
 *
 * The plaintext key is returned by `POST /admin/provisioners/:id/keys`
 * exactly once and never stored. This modal is the only chance the
 * super-admin has to copy it. Auto-copies to clipboard on open.
 */
import { tmxToast } from 'services/notifications/tmxToast';
import { copyClick } from 'services/dom/copyClick';
import { openModal } from './baseModal/baseModal';
import { t } from 'i18n';

type GeneratedKeyModalParams = {
  apiKey: string;
  label?: string;
  provisionerName?: string;
};

export function generatedKeyModal({ apiKey, label, provisionerName }: GeneratedKeyModalParams): void {
  const content = (elem: HTMLElement) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: .75rem;';

    const warn = document.createElement('div');
    warn.style.cssText =
      'background: var(--tmx-warning-bg, #fff8e1); border: 1px solid var(--tmx-accent-orange, #f5a623); padding: .6rem .75rem; border-radius: 4px; font-size: .85rem;';
    warn.textContent = t('system.keyRevealWarning');
    wrap.appendChild(warn);

    if (provisionerName || label) {
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size: .8rem; color: var(--tmx-text-secondary, #666);';
      meta.textContent = [provisionerName, label].filter(Boolean).join(' · ');
      wrap.appendChild(meta);
    }

    const keyRow = document.createElement('div');
    keyRow.style.cssText = 'display: flex; gap: .4rem; align-items: stretch;';
    const keyInput = document.createElement('input');
    keyInput.readOnly = true;
    keyInput.value = apiKey;
    keyInput.style.cssText =
      'flex: 1; font-family: ui-monospace, monospace; font-size: .8rem; padding: .5rem; border: 1px solid var(--tmx-border-primary, #ccc); border-radius: 4px; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';
    keyInput.addEventListener('focus', () => keyInput.select());
    keyRow.appendChild(keyInput);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-impersonate';
    copyBtn.textContent = t('system.copy');
    copyBtn.addEventListener('click', () => {
      copyClick(apiKey);
      tmxToast({ message: t('system.copiedToClipboard'), intent: 'is-success' });
    });
    keyRow.appendChild(copyBtn);

    wrap.appendChild(keyRow);
    elem.appendChild(wrap);

    // Auto-copy on open as a safety net
    copyClick(apiKey);
  };

  openModal({
    title: t('system.keyGenerated'),
    content,
    buttons: [{ label: t('common.iSavedIt'), intent: 'is-primary', close: true }],
  });
}
