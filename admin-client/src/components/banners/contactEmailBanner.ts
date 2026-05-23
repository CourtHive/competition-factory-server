/**
 * Post-login nag banner for users whose `contact_email` is missing or
 * unverified. Without a verified contact address, the password-reset
 * flow (B3) has no destination — so the banner exists to push users
 * into the IdentityService.setContactEmail call before B3 starts
 * needing it.
 *
 * Re-evaluated on every router navigation (cheap — just decodes the
 * cached JWT). Dismissable per-session via localStorage; dismissals
 * re-arm 24h later so a user who logs in tomorrow gets nagged again.
 *
 * Lives at #globalBanner (added in rootBlock), above the page
 * containers and below the navbar.
 */
import { getLoginState } from 'services/authentication/loginState';
import { contactEmailModal } from 'components/modals/contactEmail';
import { VERIFY_EMAIL, RESET_PASSWORD } from 'constants/tmxConstants';
import { t } from 'i18n';

const DISMISS_KEY = 'admin_contact_email_banner_dismissed_until';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  const raw = globalThis.localStorage?.getItem(DISMISS_KEY);
  if (!raw) return false;
  const until = Number(raw);
  if (!Number.isFinite(until)) return false;
  return Date.now() < until;
}

function dismiss(): void {
  globalThis.localStorage?.setItem(DISMISS_KEY, String(Date.now() + DISMISS_TTL_MS));
}

export function renderContactEmailBanner(): void {
  const container = document.getElementById('globalBanner');
  if (!container) return;
  container.innerHTML = '';

  // Public email-link landing pages are routes a non-logged-in user may
  // be on; never nag on them. (The banner only fires when logged in
  // anyway, but these guards short-circuit cleanly if a session is
  // somehow active during a reset/verify flow.)
  if (globalThis.location.hash.startsWith(`#/${VERIFY_EMAIL}/`)) return;
  if (globalThis.location.hash.startsWith(`#/${RESET_PASSWORD}/`)) return;

  const state: any = getLoginState();
  if (!state) return; // not logged in
  if (isDismissed()) return;

  const contactEmail: string | undefined = state.contactEmail;
  const emailVerifiedAt: string | undefined = state.emailVerifiedAt;
  if (contactEmail && emailVerifiedAt) return; // all good

  // Build the banner
  const banner = document.createElement('div');
  banner.style.cssText =
    'display: flex; align-items: center; justify-content: space-between; gap: 16px; ' +
    'padding: 10px 16px; background: var(--tmx-panel-yellow-bg); ' +
    'color: var(--tmx-text-primary); ' +
    'border-bottom: 1px solid var(--tmx-panel-yellow-border); font-size: 0.95rem;';

  const text = document.createElement('span');
  text.textContent = contactEmail
    ? t('banners.contactEmail.pending', { email: contactEmail })
    : t('banners.contactEmail.missing');

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; align-items: center;';

  const setupBtn = document.createElement('button');
  setupBtn.className = 'button is-small';
  setupBtn.style.cssText =
    'padding: 4px 10px; font-size: 0.85rem; border-radius: 4px; cursor: pointer; ' +
    'background: var(--tmx-accent-green-bold); color: #fff; border: 0; font-weight: 600;';
  setupBtn.textContent = contactEmail
    ? t('banners.contactEmail.review')
    : t('banners.contactEmail.setUp');
  setupBtn.addEventListener('click', () => contactEmailModal(renderContactEmailBanner));

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'button is-small is-light';
  dismissBtn.style.cssText =
    'padding: 4px 10px; font-size: 0.85rem; border-radius: 4px; cursor: pointer; ' +
    'background: transparent; color: var(--tmx-text-primary); border: 1px solid var(--tmx-border-primary);';
  dismissBtn.textContent = t('common.dismiss');
  dismissBtn.addEventListener('click', () => {
    dismiss();
    renderContactEmailBanner();
  });

  actions.append(setupBtn, dismissBtn);
  banner.append(text, actions);
  container.appendChild(banner);
}
