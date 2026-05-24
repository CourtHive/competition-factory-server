/**
 * Shown when a logged-in user has no admin-console access (e.g. a DIRECTOR-only
 * account). Replaces the old behavior of silently redirecting every non-super /
 * non-provisioner user into `/admin`.
 */
import { removeAllChildNodes } from 'services/dom/transformers';
import { showTMXadmin } from 'services/transitions/screenSlaver';
import { logOut } from 'services/authentication/loginState';
import { TMX_ADMIN } from 'constants/tmxConstants';
import { t } from 'i18n';

export function renderNoAccess(): void {
  showTMXadmin();

  const container = document.getElementById(TMX_ADMIN);
  if (!container) return;
  removeAllChildNodes(container);

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1rem; padding:3rem 1rem; text-align:center;';

  const title = document.createElement('h2');
  title.textContent = t('noAccess.title');
  title.style.cssText = 'margin:0;';

  const message = document.createElement('p');
  message.textContent = t('noAccess.message');
  message.style.cssText = 'max-width:32rem; color:var(--chc-text-secondary, var(--tmx-text-secondary, #666));';

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.textContent = t('noAccess.logOut');
  logoutBtn.style.cssText =
    'cursor:pointer; padding:0.5rem 1.25rem; border-radius:4px; border:1px solid var(--chc-border, #ccc); background:transparent;';
  logoutBtn.addEventListener('click', () => logOut());

  wrap.append(title, message, logoutBtn);
  container.appendChild(wrap);
}
