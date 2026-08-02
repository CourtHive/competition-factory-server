import { ExecutionContext, GoneException } from '@nestjs/common';

import { ProvisionerWritesMovedGuard } from './provisioner-writes-moved.guard';

function ctx(method: string): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ method }) }) } as any;
}

describe('ProvisionerWritesMovedGuard', () => {
  const guard = new ProvisionerWritesMovedGuard();
  afterEach(() => {
    delete process.env.PROVISIONER_WRITES_MOVED;
  });

  it('passes all methods when the flag is unset (default — inert)', () => {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(guard.canActivate(ctx(m))).toBe(true);
    }
  });

  it('blocks write methods with 410 Gone when the flag is set', () => {
    process.env.PROVISIONER_WRITES_MOVED = 'true';
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => guard.canActivate(ctx(m))).toThrow(GoneException);
    }
  });

  it('still allows GET reads when the flag is set', () => {
    process.env.PROVISIONER_WRITES_MOVED = 'true';
    expect(guard.canActivate(ctx('GET'))).toBe(true);
  });
});
