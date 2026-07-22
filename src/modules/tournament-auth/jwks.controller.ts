import { Controller, Get, Header } from '@nestjs/common';

import { Public } from 'src/modules/account/auth/decorators/public.decorator';
import { getJwks } from 'src/common/auth/jwtKeys';

/**
 * JWKS endpoint — publishes the public half of the ES256 signing key(s) so any
 * verifier (the relay, and eventually a lifted-out signer's peers) can validate
 * tokens by `kid` without holding a shared secret. Public + cacheable; the
 * response is non-secret by construction.
 *
 * Returns `{ keys: [] }` until asymmetric keys are provisioned — verifiers
 * simply find no key and fall back to the legacy HS256 path during migration.
 */
@Controller('.well-known')
export class JwksController {
  @Public()
  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  getJwks(): { keys: Record<string, unknown>[] } {
    return getJwks();
  }
}
