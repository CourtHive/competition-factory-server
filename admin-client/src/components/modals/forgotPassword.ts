/**
 * Forgot-password modal.
 *
 * Single-field form (contact email) that POSTs /auth/forgot-password.
 * The server is enumeration-defensive: it ALWAYS returns `{ ok: true }`,
 * whether the address is registered, unverified, or unknown. So this
 * UI uniformly shows the same "If we know you, a link is on the way"
 * toast on success — no UI signal about registration state either.
 *
 * Opens from the login modal "Forgot password?" link.
 */
import { validators, renderForm } from 'courthive-components';
import { forgotPassword } from 'services/authentication/authApi';
import { tmxToast } from 'services/notifications/tmxToast';
import { openModal } from './baseModal/baseModal';
import { t } from 'i18n';

export function forgotPasswordModal(): void {
  let inputs: any;
  let modalHandle: any;

  const enableSubmit = ({ inputs }: any) => {
    const value = inputs?.contactEmail?.value ?? '';
    const isValid = validators.emailValidator(value);
    modalHandle?.setButtonState('forgotPasswordSubmit', { disabled: !isValid });
  };

  const relationships = [{ onInput: enableSubmit, control: 'contactEmail' }];

  const content = (elem: HTMLElement) => {
    const intro = document.createElement('p');
    intro.style.cssText = 'margin: 0 0 16px 0; font-size: 0.95rem; line-height: 1.5;';
    intro.textContent = t('modals.forgotPassword.intro');
    elem.appendChild(intro);

    inputs = renderForm(
      elem,
      [
        {
          iconLeft: 'fa-regular fa-envelope',
          placeholder: 'you@example.com',
          validator: validators.emailValidator,
          autocomplete: 'email',
          label: t('modals.forgotPassword.label'),
          field: 'contactEmail',
          id: 'forgotPasswordEmail',
        },
      ],
      relationships,
    );
  };

  const onSubmit = () => {
    const value = (inputs?.contactEmail?.value ?? '').trim();
    if (!value) return;
    forgotPassword(value).then(
      () => {
        // Uniform success message regardless of server response — server
        // always returns { ok: true } to defeat enumeration, so the UI
        // matches.
        tmxToast({ message: t('modals.forgotPassword.sent'), intent: 'is-success' });
      },
      () => {
        // Network errors are user-visible — server-side enumeration
        // defense only applies to the OK path.
        tmxToast({ message: t('modals.forgotPassword.networkError'), intent: 'is-danger' });
      },
    );
  };

  modalHandle = openModal({
    title: t('modals.forgotPassword.title'),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      {
        label: t('modals.forgotPassword.submit'),
        id: 'forgotPasswordSubmit',
        disabled: true,
        onClick: onSubmit,
        close: true,
        intent: 'is-primary',
      },
    ],
  });
}
