/**
 * Per-role definition reference used by the invite/edit user modals.
 *
 * Earlier iteration was a single big `<details>` block under the Roles
 * header — too much to parse at once and it overlaid the modal content
 * messily. Now exposed as a per-role description string that callers
 * paint into a small `<i>` info icon next to each checkbox label, with
 * the description in a native `title` attribute (browser tooltip on
 * hover, no overlay, no extra deps).
 *
 * Why both shapes of role get explained here:
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

/** One-sentence description per legacy role key (lowercase). */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  client:
    'Basic tournament access. Required for any user logging into TMX or other client apps.',
  admin:
    "Provider administrator. Grants full mutate access — including delete — to all tournaments at the user's home provider (equivalent to PROVIDER_ADMIN in the per-provider role table). Without this, the user can only edit/delete tournaments they personally created or were explicitly assigned to.",
  director:
    'Tournament director. Functional role for users who run tournaments. Distinct from the per-provider DIRECTOR scope role, which is auto-derived from a user-provider association.',
  official: 'Match officials — referees, umpires, line judges.',
  score: 'Allowed to enter scores for matchups. Used by the official-app and scoring stations.',
  generate: 'Allowed to use the mocksEngine and draw-generation tools.',
  developer: 'Dev-mode features and internal debugging UIs.',
};

/**
 * Returns the role's plain-text description (no HTML), suitable for a
 * `title` attribute on the corresponding label/icon.
 */
export function roleDescription(roleKey: string): string {
  return ROLE_DESCRIPTIONS[roleKey] ?? '';
}

/**
 * Returns a label string with a trailing info icon whose `title`
 * attribute is the role description. Safe to use as a `renderForm`
 * label (which is set via innerHTML).
 */
export function labelWithRoleTip(label: string, roleKey: string): string {
  const desc = roleDescription(roleKey);
  if (!desc) return label;
  // Title attribute is auto-escaped by the browser; description content
  // is hand-authored above so no untrusted input is interpolated here.
  return `${label} <i class="fa-solid fa-circle-info" style="opacity:0.5; cursor:help; margin-left:4px;" title="${desc}"></i>`;
}
