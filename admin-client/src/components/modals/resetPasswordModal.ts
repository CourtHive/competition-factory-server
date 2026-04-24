import { adminResetPassword } from 'services/apis/servicesApi';
import { tmxToast } from 'services/notifications/tmxToast';
import { copyClick } from 'services/dom/copyClick';
import { openModal } from './baseModal/baseModal';
import { t } from 'i18n';

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function resetPasswordModal({ email, displayName }: { email: string; displayName: string }): void {
  const content = document.createElement('div');
  content.style.cssText = 'min-width: 360px;';

  const label = document.createElement('label');
  label.textContent = `${t('system.newPassword')} for ${displayName}`;
  label.style.cssText = 'display: block; font-size: 0.85rem; margin-bottom: 6px; color: var(--tmx-text-secondary);';

  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display: flex; gap: 8px; align-items: center;';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = '';
  input.placeholder = 'Enter password or generate one';
  input.style.cssText =
    'flex: 1; padding: 8px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; font-family: monospace; font-size: 0.9rem; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';

  const genBtn = document.createElement('button');
  genBtn.className = 'btn-edit';
  genBtn.textContent = t('system.generatePassword');
  genBtn.addEventListener('click', () => {
    input.value = generatePassword();
  });

  inputRow.appendChild(input);
  inputRow.appendChild(genBtn);
  content.appendChild(label);
  content.appendChild(inputRow);

  const doReset = () => {
    const newPassword = input.value.trim() || undefined;
    adminResetPassword({ email, newPassword }).then(
      (res: any) => {
        const password = res?.data?.password;
        if (password) {
          copyClick(password);
          tmxToast({ message: t('system.passwordCopied'), intent: 'is-success' });
        } else {
          tmxToast({ message: t('system.passwordReset'), intent: 'is-success' });
        }
      },
      () => {
        tmxToast({ message: t('system.passwordResetError'), intent: 'is-danger' });
      },
    );
  };

  openModal({
    title: t('system.resetPasswordTitle'),
    content,
    buttons: [
      { label: t('common.cancel'), close: true },
      { label: t('system.resetPassword'), onClick: doReset, close: true, intent: 'is-warning' },
    ],
  });
}
