import { UnauthorizedException } from '@nestjs/common';

import { ProviderApiKeyGuard } from './provider-api-key.guard';

function makeContext(request: any): any {
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

describe('ProviderApiKeyGuard', () => {
  let guard: ProviderApiKeyGuard;

  beforeEach(() => {
    guard = new ProviderApiKeyGuard();
  });

  it('allows requests with a provider identity attached', () => {
    const request = { provider: { providerId: 'kronos' } };
    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('rejects requests without request.provider', () => {
    const request = {};
    expect(() => guard.canActivate(makeContext(request))).toThrow(UnauthorizedException);
  });

  it('rejects requests where request.provider exists but providerId is missing', () => {
    const request = { provider: {} };
    expect(() => guard.canActivate(makeContext(request))).toThrow(UnauthorizedException);
  });
});
