import { getToken, setToken, removeToken } from './tokenManagement';
import { validateToken } from './validateToken';
import { tmxToast } from 'services/notifications/tmxToast';
import { context } from 'services/context';
import { t } from 'i18n';

import { SUPER_ADMIN, ADMIN, PROVISIONER } from 'constants/tmxConstants';
import type { LoginState } from 'types/tmx';

export function styleLogin(state?: LoginState): void {
  const el = document.getElementById('login');
  if (!el) return;

  el.classList.remove('logged-in-admin', 'logged-in-superadmin');

  if (state?.roles?.includes(SUPER_ADMIN)) {
    el.classList.add('logged-in-superadmin');
  } else if (state?.roles?.includes(ADMIN)) {
    el.classList.add('logged-in-admin');
  }
}

export function getLoginState(): LoginState | undefined {
  const token = getToken();
  const state = validateToken(token);
  styleLogin(state);
  return state;
}

export function logIn({ data, callback }: { data: { token: string }; callback?: () => void }): void {
  const state = validateToken(data.token);
  if (state) {
    setToken(data.token);
    tmxToast({ message: t('toasts.loggedIn'), intent: 'is-success' });
    styleLogin(state);

    if (callback) {
      callback();
    } else {
      // Navigate to appropriate page based on role
      if (state.roles?.includes(SUPER_ADMIN)) {
        context.router?.navigate('/system');
      } else if (state.roles?.includes(PROVISIONER)) {
        context.router?.navigate('/provisioner');
      } else {
        context.router?.navigate('/admin');
      }
    }
  }
}

export function logOut(): void {
  removeToken();
  context.provider = undefined;
  context.state.authorized = false;
  context.state.admin = false;
  styleLogin(undefined);
  context.router?.navigate('/');
}

export function initLoginToggle(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;

  el.addEventListener('click', () => {
    const state = getLoginState();
    if (state) {
      // Logged in — show logout option
      logOut();
    } else {
      // Not logged in — show login modal
      import('components/modals/loginModal').then(({ loginModal }) => loginModal());
    }
  });
}
