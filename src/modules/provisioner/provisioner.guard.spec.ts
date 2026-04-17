import { ProvisionerGuard, ProvisionerProviderGuard, ProvisionerOwnerGuard } from './provisioner.guard';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';

function makeContext(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('ProvisionerGuard', () => {
  const guard = new ProvisionerGuard();

  it('allows when request.provisioner is set', () => {
    const ctx = makeContext({ provisioner: { provisionerId: 'p1' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException when no provisioner', () => {
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});

describe('ProvisionerProviderGuard', () => {
  const guard = new ProvisionerProviderGuard();

  it('allows when provisioner + X-Provider-Id + relationship set', () => {
    const ctx = makeContext({
      provisioner: { provisionerId: 'p1' },
      headers: { 'x-provider-id': 'prov-a' },
      provisionerRelationship: 'owner',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws when no provisioner', () => {
    const ctx = makeContext({ headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when no X-Provider-Id header', () => {
    const ctx = makeContext({ provisioner: { provisionerId: 'p1' }, headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws when provider not managed', () => {
    const ctx = makeContext({
      provisioner: { provisionerId: 'p1' },
      headers: { 'x-provider-id': 'unmanaged' },
      provisionerRelationship: undefined,
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

describe('ProvisionerOwnerGuard', () => {
  const guard = new ProvisionerOwnerGuard();

  it('allows when relationship is owner', () => {
    const ctx = makeContext({ provisioner: { provisionerId: 'p1' }, provisionerRelationship: 'owner' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws when relationship is subsidiary', () => {
    const ctx = makeContext({ provisioner: { provisionerId: 'p1' }, provisionerRelationship: 'subsidiary' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws when no provisioner', () => {
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
