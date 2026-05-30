import { SetMetadata } from '@nestjs/common';

export const AUDIENCE_KEY = 'jwtAudience';

export type AudienceClaim = 'admin' | 'hiveid';

/**
 * Routes mark which JWT `aud` claim(s) they require. AuthGuard reads this
 * via Reflector and admits a token only when its `aud` claim overlaps the
 * required set. When the decorator is absent the guard defaults to
 * `['admin']` — that preserves admin-side behavior for routes that
 * pre-date HiveID.
 *
 * Legacy tokens minted before this refactor lack an `aud` claim entirely
 * and are treated as admin tokens by the guard, so existing sessions
 * keep working without forced re-login.
 *
 * Usage:
 *   `@Audience(['hiveid'])` on a controller or method
 *   `@Audience(['admin', 'hiveid'])` for endpoints accepting either
 */
export const Audience = (audiences: AudienceClaim[]) => SetMetadata(AUDIENCE_KEY, audiences);
