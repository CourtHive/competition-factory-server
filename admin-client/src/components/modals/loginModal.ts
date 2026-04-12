import { systemLogin } from 'services/authentication/authApi';
import { logIn } from 'services/authentication/loginState';
import { renderForm } from 'courthive-components';
import { openModal } from './baseModal/baseModal';
import { t } from 'i18n';

export function loginModal(callback?: () => void): void {
  let inputs: any;

  const content = document.createElement('div');
  inputs = renderForm(content, [
    {
      iconLeft: 'fa-regular fa-envelope',
      placeholder: t('modals.login.emailPlaceholder'),
      label: t('modals.login.emailLabel'),
      field: 'email',
    },
    {
      placeholder: t('modals.login.passwordPlaceholder'),
      iconLeft: 'fa-solid fa-lock',
      label: t('modals.login.passwordLabel'),
      field: 'password',
      type: 'password',
    },
  ]);

  const submitCredentials = () => {
    const email = inputs.email.value;
    const password = inputs.password.value;
    if (!email || !password) return;

    systemLogin(email, password).then(
      (res: any) => {
        if (res?.status === 200) logIn({ data: res.data, callback });
      },
      (err: any) => console.error('Login failed:', err),
    );
  };

  openModal({
    title: t('modals.login.title'),
    content,
    buttons: [
      { label: t('common.cancel'), close: true },
      { onClick: submitCredentials, label: t('modals.login.loginButton'), close: true },
    ],
  });
}
