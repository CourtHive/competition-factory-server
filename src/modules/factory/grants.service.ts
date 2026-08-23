import { Inject, Injectable } from '@nestjs/common';

import { GRANT_STORAGE, type IGrantStorage } from 'src/storage/interfaces';
import { isWithinWindow } from './helpers/grantScope';

import type { UserContext } from '../account/auth/decorators/user-context.decorator';
import type { GrantScope } from './helpers/grantScope';

/** What a client needs to shape its UI. Deliberately not the storage row. */
export type CallerGrant = {
  capability: string;
  scope: GrantScope;
  notBefore?: string | null;
  notAfter?: string | null;
};

@Injectable()
export class GrantsService {
  constructor(@Inject(GRANT_STORAGE) private readonly grantStorage: IGrantStorage) {}

  /**
   * The caller's own live grants on a tournament, so the client can shape its UI
   * to what the server would actually permit.
   *
   * Returns the caller's rows only — never another subject's — so there is
   * nothing here to leak. Expired and not-yet-live grants are filtered out
   * rather than shipped with their windows, because a client that had to
   * re-implement the window check would be a second place for that logic to
   * drift from the gate.
   *
   * An empty array is NOT "restricted to nothing". It means the subject holds no
   * scoped grants and is therefore unrestricted by this mechanism, which is what
   * the server-side gate concludes too.
   */
  async forCaller(tournamentId: string, userContext: UserContext | undefined): Promise<CallerGrant[]> {
    if (!userContext?.userId || !tournamentId) return [];
    try {
      const rows = await this.grantStorage.findForSubject(userContext.userId, tournamentId);
      return rows
        .filter((row) => isWithinWindow(row))
        .map(({ capability, scope, notBefore, notAfter }) => ({ capability, scope, notBefore, notAfter }));
    } catch {
      // Storage unavailable (migration not yet applied) — the gate falls through
      // to the coarse checks in that case, so the client should too.
      return [];
    }
  }
}
