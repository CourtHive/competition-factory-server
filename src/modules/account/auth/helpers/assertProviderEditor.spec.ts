import { ForbiddenException } from '@nestjs/common';

import { assertProviderEditor } from './assertProviderEditor';
import type { UserContext } from '../decorators/user-context.decorator';
import type { IProvisionerProviderStorage } from 'src/storage/interfaces';

const PROVIDER_P = 'provider-p';
const PROVIDER_OTHER = 'provider-other';

function ctx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'u-1',
    email: 'editor@test.com',
    isSuperAdmin: false,
    globalRoles: ['client'],
    providerRoles: {},
    providerIds: [],
    ...overrides,
  };
}

function mockProvisionerProviderStorage(
  pairs: Array<[string, string]>,
): IProvisionerProviderStorage {
  // pairs: [provisionerId, providerId][] — getRelationship returns 'owner'
  // when the (provisionerId, providerId) pair is in `pairs`, else null.
  return {
    getRelationship: jest.fn(async (provisionerId: string, providerId: string) =>
      pairs.some(([pn, pd]) => pn === provisionerId && pd === providerId) ? ('owner' as const) : null,
    ),
  } as any;
}

describe('assertProviderEditor', () => {
  it('throws when userContext is undefined', async () => {
    await expect(
      assertProviderEditor({ userContext: undefined, providerId: PROVIDER_P }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows SUPER_ADMIN at any provider', async () => {
    await expect(
      assertProviderEditor({
        userContext: ctx({ isSuperAdmin: true }),
        providerId: PROVIDER_P,
      }),
    ).resolves.toBeUndefined();
  });

  it('allows PROVIDER_ADMIN at the matching provider', async () => {
    await expect(
      assertProviderEditor({
        userContext: ctx({
          providerRoles: { [PROVIDER_P]: 'PROVIDER_ADMIN' },
          providerIds: [PROVIDER_P],
        }),
        providerId: PROVIDER_P,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects PROVIDER_ADMIN at a different provider', async () => {
    await expect(
      assertProviderEditor({
        userContext: ctx({
          providerRoles: { [PROVIDER_OTHER]: 'PROVIDER_ADMIN' },
          providerIds: [PROVIDER_OTHER],
        }),
        providerId: PROVIDER_P,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects DIRECTOR at the matching provider', async () => {
    await expect(
      assertProviderEditor({
        userContext: ctx({
          providerRoles: { [PROVIDER_P]: 'DIRECTOR' },
          providerIds: [PROVIDER_P],
        }),
        providerId: PROVIDER_P,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows PROVISIONER administering the provider', async () => {
    const storage = mockProvisionerProviderStorage([['prov-1', PROVIDER_P]]);
    await expect(
      assertProviderEditor({
        userContext: ctx(),
        providerId: PROVIDER_P,
        provisionerIds: ['prov-1'],
        provisionerProviderStorage: storage,
      }),
    ).resolves.toBeUndefined();
    expect(storage.getRelationship).toHaveBeenCalledWith('prov-1', PROVIDER_P);
  });

  it('rejects PROVISIONER who does not administer the provider', async () => {
    const storage = mockProvisionerProviderStorage([['prov-1', PROVIDER_OTHER]]);
    await expect(
      assertProviderEditor({
        userContext: ctx(),
        providerId: PROVIDER_P,
        provisionerIds: ['prov-1'],
        provisionerProviderStorage: storage,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('checks all provisionerIds, allowing if any one administers the provider', async () => {
    const storage = mockProvisionerProviderStorage([['prov-2', PROVIDER_P]]);
    await expect(
      assertProviderEditor({
        userContext: ctx(),
        providerId: PROVIDER_P,
        provisionerIds: ['prov-1', 'prov-2'],
        provisionerProviderStorage: storage,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects when provisioner check is requested but storage is missing', async () => {
    await expect(
      assertProviderEditor({
        userContext: ctx(),
        providerId: PROVIDER_P,
        provisionerIds: ['prov-1'],
        // intentionally no storage
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
