/**
 * Server instance profiles control which NestJS modules are loaded.
 *
 * - tournament: Tournament operations only (factory, messaging, cache)
 * - provider:   Provider/org operations (sanctioning, officiating, calendar, email)
 * - full:       All modules (default — suitable for small orgs or development)
 *
 * Set via SERVER_PROFILE env var. Defaults to 'full'.
 */

export type ServerProfile = 'tournament' | 'provider' | 'full';

export function getServerProfile(): ServerProfile {
  const profile = process.env.SERVER_PROFILE as ServerProfile;
  if (profile && ['tournament', 'provider', 'full'].includes(profile)) return profile;
  return 'full';
}

/**
 * Returns true if the given module group should be loaded for the current profile.
 */
export function isModuleEnabled(group: 'tournament' | 'provider'): boolean {
  const profile = getServerProfile();
  if (profile === 'full') return true;
  return profile === group;
}
