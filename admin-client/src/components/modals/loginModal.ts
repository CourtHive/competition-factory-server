/**
 * Login modal with email and password validation.
 * Authenticates user credentials and updates login state on success.
 *
 * When the server flags the user as `mustChangePassword` (admin-assigned
 * password awaiting first use), it returns a short-lived limited token
 * instead of a full session JWT. We hand that token to
 * firstLoginPasswordModal which calls /auth/complete-first-login to set
 * the user's chosen password and then completes the sign-in.
 */
import { firstLoginPasswordModal } from './firstLoginPassword';
import { forgotPasswordModal } from './forgotPassword';
import { logIn, logOut } from 'services/authentication/loginState';
import { renderForm, validators } from 'courthive-components';
import { systemLogin } from 'services/authentication/authApi';
import { closeModal, openModal } from './baseModal/baseModal';
import { t } from 'i18n';

export function loginModal(callback?: () => void): void {
  let inputs: any;
  let modalHandle: any;

  const enableSubmit = ({ inputs }: any) => {
    const value = inputs['email'].value;
    const isValid = validators.emailValidator(value);
    modalHandle?.setButtonState('loginButton', { disabled: !isValid });
  };

  const relationships = [
    {
      onInput: enableSubmit,
      control: 'email',
    },
  ];

  const content = (elem: HTMLElement) => {
    inputs = renderForm(
      elem,
      [
        {
          iconLeft: 'fa-regular fa-envelope',
          placeholder: t('modals.login.emailPlaceholder'),
          validator: validators.emailValidator,
          autocomplete: 'email',
          label: t('modals.login.emailLabel'),
          field: 'email',
          id: 'loginEmail',
        },
        {
          placeholder: t('modals.login.passwordPlaceholder'),
          autocomplete: 'current-password',
          iconLeft: 'fa-solid fa-lock',
          label: t('modals.login.passwordLabel'),
          field: 'password',
          type: 'password',
          id: 'loginPassword',
        },
      ],
      relationships,
    );

    // Forgot-password link — opens the forgotPasswordModal in a separate
    // dialog. Always visible (not just on auth failure) so a user who
    // KNOWS they don't have a password yet can reach it directly.
    const forgotLink = document.createElement('a');
    forgotLink.href = '#';
    forgotLink.textContent = t('modals.login.forgotPassword');
    forgotLink.style.cssText =
      'display: inline-block; margin-top: 8px; font-size: 0.85rem; ' +
      'color: var(--tmx-text-secondary, #64748b); text-decoration: underline; cursor: pointer;';
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Close the login modal first so the two don't stack visually.
      closeModal();
      forgotPasswordModal();
    });
    elem.appendChild(forgotLink);
  };

  const submitCredentials = () => {
    const email = inputs.email.value;
    const password = inputs.password.value;
    const response = (res: any) => {
      if (!res) logOut();
      if (res?.status !== 200) return;
      // First-login branch: server signals an admin-assigned password
      // that must be changed before a full session is issued.
      if (res.data?.mustChangePassword && res.data?.limitedToken) {
        firstLoginPasswordModal({ limitedToken: res.data.limitedToken, callback });
        return;
      }
      logIn({ data: res.data, callback });
    };
    systemLogin(email, password).then(response, (err: any) => console.log({ err }));
  };

  modalHandle = openModal({
    title: t('modals.login.title'),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      {
        onClick: submitCredentials,
        intent: 'is-primary',
        id: 'loginButton',
        disabled: true,
        label: t('modals.login.loginButton'),
        close: true,
      },
    ],
  });
}
