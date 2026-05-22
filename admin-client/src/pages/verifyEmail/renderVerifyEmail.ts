/**
 * Public verify-email page.
 *
 * Rendered when the user clicks the link in the verification email,
 * which lands at `/admin/#/verify-email/<token>`. Shows a "Verify" button
 * that POSTs to /auth/verify-email so a link-previewer (Slack, Discord,
 * spam scanner) can't consume the single-use token by GET-fetching the
 * URL.
 *
 * No authentication required — the token IS the auth.
 */
import { showTMXverifyEmail } from 'services/transitions/screenSlaver';
import { verifyEmail } from 'services/authentication/authApi';
import { TMX_VERIFY_EMAIL } from 'constants/tmxConstants';
import { t } from 'i18n';

export function renderVerifyEmail(token: string): void {
  showTMXverifyEmail();
  const container = document.getElementById(TMX_VERIFY_EMAIL);
  if (!container) return;
  container.innerHTML = '';

  const card = document.createElement('div');
  card.style.cssText =
    'margin: 64px auto; max-width: 480px; background: var(--tmx-bg-elevated, #fff); ' +
    'padding: 32px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); ' +
    'text-align: center; color: var(--tmx-text-primary, #1a1a1a);';

  const heading = document.createElement('h2');
  heading.textContent = t('verifyEmail.title');
  heading.style.cssText = 'margin: 0 0 16px 0; font-size: 22px; font-weight: 600;';

  const body = document.createElement('p');
  body.style.cssText = 'margin: 0 0 24px 0; font-size: 15px; line-height: 1.55;';

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'margin-top: 16px; font-size: 14px;';

  const button = document.createElement('button');
  button.className = 'button is-primary';
  button.textContent = t('verifyEmail.verifyButton');
  button.style.cssText =
    'padding: 10px 20px; font-size: 15px; border-radius: 6px; cursor: pointer; ' +
    'background: var(--tmx-status-success, #0f766e); color: #fff; border: 0; font-weight: 600;';

  if (!token) {
    body.textContent = t('verifyEmail.missingToken');
    card.append(heading, body);
    container.appendChild(card);
    return;
  }

  body.textContent = t('verifyEmail.intro');

  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = t('verifyEmail.verifying');
    verifyEmail(token).then(
      (res: any) => {
        const email = res?.data?.contactEmail ?? '';
        statusEl.style.color = 'var(--tmx-status-success, #2e7d32)';
        statusEl.textContent = email
          ? t('verifyEmail.success', { email })
          : t('verifyEmail.successPlain');
        button.style.display = 'none';
      },
      (err: any) => {
        button.disabled = false;
        button.textContent = t('verifyEmail.tryAgain');
        statusEl.style.color = 'var(--tmx-status-error, #c62828)';
        const status = err?.response?.status;
        if (status === 401) {
          statusEl.textContent = t('verifyEmail.tokenExpired');
        } else if (status === 403) {
          statusEl.textContent = t('verifyEmail.tokenMismatch');
        } else {
          statusEl.textContent = err?.response?.data?.message || t('verifyEmail.failed');
        }
      },
    );
  });

  card.append(heading, body, button, statusEl);
  container.appendChild(card);
}
