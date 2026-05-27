import { cModal } from 'courthive-components';
import { t } from 'i18n';

import { NONE } from 'constants/tmxConstants';

export function closeModal() {
  cModal.close();
}

type OpenModal = {
  buttons: { id?: string; disabled?: boolean; label: string; intent?: string; onClick?: () => void; close?: boolean }[];
  onClose?: () => void;
  footer?: string;
  title: string;
  content: any;
  config?: any; // Allow custom config to be passed through
};

export function openModal(params: OpenModal) {
  const { title, content, buttons, footer, onClose, config: customConfig } = params;
  const noPadding = !title && !buttons;
  // When padding isn't forced to empty (bare content modals), omit it so the
  // cModal default applies — keeps admin modals consistent with the shared default.
  const config = customConfig || (noPadding ? { padding: '', maxWidth: 500 } : { maxWidth: 500 });
  return cModal.open({ title, content, footer, buttons, config, onClose });
}

export function informModal({ message, title, okAction }) {
  const buttons = [{ label: 'Ok', onClick: okAction, close: true }];
  return cModal.open({ title, content: message, buttons });
}

type ConfirmModalOptions = {
  title?: string;
  query: any;
  okAction: () => void | Promise<void>;
  cancelAction?: () => void;
  okIntent?: string;
};

export function confirmModal({ title, query, okAction, cancelAction, okIntent }: ConfirmModalOptions) {
  // cModal handles dismissal automatically when close: true, so we leave
  // onClick undefined unless the caller wants a side-effect on cancel.
  const buttons = [
    {
      onClick: cancelAction,
      label: 'Cancel',
      intent: NONE,
      close: true,
    },
    okAction && {
      intent: okIntent || 'is-warning',
      onClick: okAction,
      label: 'Ok',
      close: true,
    },
  ].filter(Boolean);

  return cModal.open({ title: title || t('act'), content: query, buttons });
}

// Themed text-prompt — the in-house replacement for window.prompt. NEVER reach
// for the native dialog: we own the look/feel of every modal in this console.
// okAction always fires with a (possibly empty) string; callers map "" →
// undefined themselves when they care to.
type PromptModalOptions = {
  title?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  okIntent?: string;
  cancelLabel?: string;
  okAction: (value: string) => void;
  cancelAction?: () => void;
};

export function promptModal(options: PromptModalOptions) {
  let inputEl: HTMLInputElement | null = null;

  const content = (elem: HTMLElement) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    if (options.label) {
      const label = document.createElement('div');
      label.textContent = options.label;
      label.style.cssText = 'font-size: 0.9em; color: var(--tmx-text-secondary, var(--tmx-text-primary));';
      wrap.appendChild(label);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'console-input';
    input.style.cssText = 'width: 100%;';
    if (options.defaultValue !== undefined) input.value = options.defaultValue;
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = input.value;
        cModal.close();
        options.okAction(value);
      }
    });
    wrap.appendChild(input);
    inputEl = input;
    setTimeout(() => input.focus(), 100);

    elem.appendChild(wrap);
  };

  const buttons = [
    {
      onClick: options.cancelAction,
      label: options.cancelLabel || 'Cancel',
      intent: NONE,
      close: true,
    },
    {
      intent: options.okIntent || 'is-info',
      onClick: () => options.okAction(inputEl?.value ?? ''),
      label: options.okLabel || 'Ok',
      close: true,
    },
  ];

  return cModal.open({ title: options.title || t('act'), content, buttons });
}
