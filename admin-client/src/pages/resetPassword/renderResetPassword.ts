/**
 * Public reset-password landing page.
 *
 * Rendered when the user clicks the link in the password-reset email,
 * which lands at `/admin/#/reset-password/<token>`. Collects a new
 * password + confirmation, POSTs to /auth/reset-password. Same
 * link-previewer defense as /verify-email — server expects a POST, not
 * a GET, so a URL-fetcher can't accidentally consume the token.
 *
 * No authentication required — the token IS the auth.
 */
import { showTMXresetPassword } from 'services/transitions/screenSlaver';
import { resetPassword } from 'services/authentication/authApi';
import { TMX_RESET_PASSWORD } from 'constants/tmxConstants';
import { context } from 'services/context';
import { t } from 'i18n';

const MIN_PASSWORD_LENGTH = 8;

export function renderResetPassword(token: string): void {
  showTMXresetPassword();
  const container = document.getElementById(TMX_RESET_PASSWORD);
  if (!container) return;
  container.innerHTML = '';

  const card = document.createElement('div');
  card.style.cssText =
    'margin: 64px auto; max-width: 480px; background: var(--tmx-bg-elevated, #fff); ' +
    'padding: 32px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); ' +
    'color: var(--tmx-text-primary, #1a1a1a);';

  const heading = document.createElement('h2');
  heading.textContent = t('resetPassword.title');
  heading.style.cssText = 'margin: 0 0 12px 0; font-size: 22px; font-weight: 600;';

  const intro = document.createElement('p');
  intro.style.cssText = 'margin: 0 0 24px 0; font-size: 15px; line-height: 1.55;';

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'margin-top: 16px; font-size: 14px;';

  if (!token) {
    intro.textContent = t('resetPassword.missingToken');
    card.append(heading, intro);
    container.appendChild(card);
    return;
  }

  intro.textContent = t('resetPassword.intro');

  // Form: new password + confirm
  const inputStyle =
    'width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid var(--tmx-border-primary, #d1d5db); ' +
    'border-radius: 6px; background: var(--tmx-bg-primary, #fff); color: var(--tmx-text-primary, #1a1a1a); ' +
    'box-sizing: border-box; margin-bottom: 12px; font-family: inherit;';

  const newInput = document.createElement('input');
  newInput.type = 'password';
  newInput.placeholder = t('resetPassword.newPasswordPlaceholder');
  newInput.autocomplete = 'new-password';
  newInput.style.cssText = inputStyle;

  const confirmInput = document.createElement('input');
  confirmInput.type = 'password';
  confirmInput.placeholder = t('resetPassword.confirmPlaceholder');
  confirmInput.autocomplete = 'new-password';
  confirmInput.style.cssText = inputStyle;

  const submit = document.createElement('button');
  submit.className = 'button is-primary';
  submit.textContent = t('resetPassword.submit');
  submit.disabled = true;
  submit.style.cssText =
    'padding: 10px 20px; font-size: 15px; border-radius: 6px; cursor: pointer; ' +
    'background: var(--tmx-status-success, #0f766e); color: #fff; border: 0; font-weight: 600; width: 100%;';

  const updateEnabled = () => {
    submit.disabled = newInput.value.length < MIN_PASSWORD_LENGTH || newInput.value !== confirmInput.value;
  };
  newInput.addEventListener('input', updateEnabled);
  confirmInput.addEventListener('input', updateEnabled);

  submit.addEventListener('click', () => {
    submit.disabled = true;
    submit.textContent = t('resetPassword.submitting');
    resetPassword(token, newInput.value).then(
      () => {
        statusEl.style.color = 'var(--tmx-status-success, #2e7d32)';
        statusEl.textContent = t('resetPassword.success');
        // Hide the form so the success message is the only thing left.
        newInput.style.display = 'none';
        confirmInput.style.display = 'none';
        submit.style.display = 'none';
        // Auto-redirect to the login modal after a short delay so the
        // user knows what's expected next.
        setTimeout(() => {
          context.router?.navigate('/');
        }, 2500);
      },
      (err: any) => {
        submit.disabled = false;
        submit.textContent = t('resetPassword.submit');
        statusEl.style.color = 'var(--tmx-status-error, #c62828)';
        const status = err?.response?.status;
        if (status === 401) {
          statusEl.textContent = t('resetPassword.tokenExpired');
        } else if (status === 403) {
          statusEl.textContent = t('resetPassword.tokenMismatch');
        } else {
          statusEl.textContent = err?.response?.data?.message || t('resetPassword.failed');
        }
      },
    );
  });

  card.append(heading, intro, newInput, confirmInput, submit, statusEl);
  container.appendChild(card);
}
