/**
 * Inline reference for the role checkboxes in the invite/edit user modals.
 *
 * Returns an HTML string suitable for `renderForm`'s `text` field, which
 * sets `innerHTML`. Wrapped in a native `<details>` element so it's
 * keyboard-accessible without any extra JS. The content is collapsed
 * by default — open on click of the summary.
 *
 * Why both shaped roles get explained here:
 *   - The visible checkboxes write to `users.roles` (legacy global +
 *     functional role array).
 *   - The new per-provider scope role lives in `user_providers.provider_role`
 *     (`PROVIDER_ADMIN` or `DIRECTOR`). The legacy `'admin'` checkbox is
 *     promoted to `PROVIDER_ADMIN` at request time by a back-compat shim
 *     in `buildUserContext`.
 *
 * Description copy is kept here rather than in i18n for now because the
 * surface is admin-only and English-only. When the admin app picks up
 * i18n for descriptions, swap to t() calls.
 */
import { t } from 'i18n';

interface RoleDef {
  /** Lowercase role key as stored in users.roles. */
  key: string;
  /** Human-friendly label — reuse i18n key from inviteUser.* */
  labelKey: string;
  /** One- or two-sentence description shown in the popover. */
  description: string;
}

const ROLE_DEFS: RoleDef[] = [
  {
    key: 'client',
    labelKey: 'modals.inviteUser.client',
    description:
      'Basic tournament access. Required for any user logging into TMX or other client apps.',
  },
  {
    key: 'admin',
    labelKey: 'modals.inviteUser.admin',
    description:
      "Provider administrator. Grants full mutate access to <em>all</em> tournaments at the user's home provider — equivalent to <code>PROVIDER_ADMIN</code> in the new role table. Without this, the user can only edit/delete tournaments they personally created or were explicitly assigned to.",
  },
  {
    key: 'director',
    labelKey: 'modals.inviteUser.director',
    description:
      'Tournament director. Functional role for users who run tournaments. Distinct from the per-provider <code>DIRECTOR</code> scope role, which is auto-derived from a user-provider association.',
  },
  {
    key: 'official',
    labelKey: 'modals.inviteUser.official',
    description: 'Match officials — referees, umpires, line judges.',
  },
  {
    key: 'score',
    labelKey: 'modals.inviteUser.scoring',
    description:
      'Allowed to enter scores for matchups. Used by the official-app and scoring stations.',
  },
  {
    key: 'generate',
    labelKey: 'modals.inviteUser.generate',
    description:
      'Allowed to use the mocksEngine and draw-generation tools.',
  },
  {
    key: 'developer',
    labelKey: 'modals.inviteUser.developer',
    description: 'Dev-mode features and internal debugging UIs.',
  },
];

/** HTML for a `<details>` block that explains every checkbox role. */
export function roleDefinitionsHtml(): string {
  const items = ROLE_DEFS.map(
    (r) =>
      `<dt style="font-weight:600; margin-top:0.6em;">${t(r.labelKey)}</dt>` +
      `<dd style="margin:0.15em 0 0 0; opacity:0.85;">${r.description}</dd>`,
  ).join('');

  return [
    `<details style="font-weight:normal; font-size:0.85em; margin-top:-0.3em;">`,
    `  <summary style="cursor:help; user-select:none; opacity:0.75; display:inline-flex; align-items:center; gap:6px;">`,
    `    <i class="fa-solid fa-circle-info"></i>`,
    `    <span>${t('modals.inviteUser.roleDefs.toggle')}</span>`,
    `  </summary>`,
    `  <dl style="margin:0.6em 0 0.4em 1.4em; padding:0.6em 0.9em; border-left:3px solid var(--tmx-border-secondary, #ccc); background:var(--tmx-bg-secondary, rgba(128,128,128,0.05)); border-radius:0 4px 4px 0;">`,
    items,
    `  </dl>`,
    `</details>`,
  ].join('');
}
