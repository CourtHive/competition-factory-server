import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../account/auth/decorators/public.decorator';
import { I18nAdminController, I18nController } from './i18n.controller';

describe('I18nController', () => {
  const reflector = new Reflector();

  it('is decorated @Public() so unauthenticated clients can fetch language files', () => {
    // The TMX boot path (i18n manifest + locale fetches) must succeed before
    // login and in demo flows where the user never logs in. AuthGuard reads
    // this metadata to bypass JWT validation.
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, I18nController)).toBe(true);
  });

  it('does NOT mark the admin controller @Public()', () => {
    // Hot-reloading the manifest from disk remains ADMIN/SUPER_ADMIN gated.
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, I18nAdminController)).toBeUndefined();
  });
});
