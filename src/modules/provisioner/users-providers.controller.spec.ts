import { ConflictException, ForbiddenException } from '@nestjs/common';

import { UsersProvidersController } from './users-providers.controller';
import type { UserContext } from '../auth/decorators/user-context.decorator';
import type {
  IUserProviderStorage,
  IProvisionerProviderStorage,
} from 'src/storage/interfaces';

const PROVIDER_P = 'provider-p';
const PROVIDER_OTHER = 'provider-other';
const TARGET_USER_ID = 'target-user-uuid';

function ctx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'editor-uuid',
    email: 'editor@test.com',
    isSuperAdmin: false,
    globalRoles: ['client'],
    providerRoles: {},
    providerIds: [],
    ...overrides,
  };
}

function makeUserProviderStorage(rows: any[] = []): IUserProviderStorage {
  return {
    findByUserIdEnriched: jest.fn(async (uid: string, allowed?: string[]) => {
      const matches = rows.filter((r) => r.userId === uid);
      return allowed ? matches.filter((r) => allowed.includes(r.providerId)) : matches;
    }),
    findByUserId: jest.fn(async (uid: string) => rows.filter((r) => r.userId === uid)),
    findByEmail: jest.fn(),
    findByProviderId: jest.fn(async (pid: string) => rows.filter((r) => r.providerId === pid)),
    findOne: jest.fn(async (uid: string, pid: string) =>
      rows.find((r) => r.userId === uid && r.providerId === pid) ?? null,
    ),
    upsert: jest.fn(async () => ({ success: true })),
    remove: jest.fn(async () => ({ success: true })),
  };
}

function makeProvisionerProviderStorage(): IProvisionerProviderStorage {
  return {
    findByProvisioner: jest.fn(async () => []),
    findByProvider: jest.fn(),
    getRelationship: jest.fn(async () => null),
    associate: jest.fn(),
    updateRelationship: jest.fn(),
    disassociate: jest.fn(),
  };
}

function build(opts: { storage?: IUserProviderStorage; provStorage?: IProvisionerProviderStorage } = {}) {
  const storage = opts.storage ?? makeUserProviderStorage();
  const provStorage = opts.provStorage ?? makeProvisionerProviderStorage();
  const controller = new UsersProvidersController(storage, provStorage);
  return { controller, storage, provStorage };
}

describe('UsersProvidersController.list', () => {
  it('returns all rows for super-admin (no scope filter)', async () => {
    const rows = [
      { userId: TARGET_USER_ID, providerId: PROVIDER_P, providerRole: 'PROVIDER_ADMIN' },
      { userId: TARGET_USER_ID, providerId: PROVIDER_OTHER, providerRole: 'DIRECTOR' },
    ];
    const { controller, storage } = build({ storage: makeUserProviderStorage(rows) });

    const result = await controller.list(TARGET_USER_ID, {}, ctx({ isSuperAdmin: true }));

    expect(storage.findByUserIdEnriched).toHaveBeenCalledWith(TARGET_USER_ID, undefined);
    expect(result).toHaveLength(2);
  });

  it('scopes to PROVIDER_ADMIN providers for non-super-admin', async () => {
    const rows = [
      { userId: TARGET_USER_ID, providerId: PROVIDER_P, providerRole: 'DIRECTOR' },
      { userId: TARGET_USER_ID, providerId: PROVIDER_OTHER, providerRole: 'DIRECTOR' },
    ];
    const { controller, storage } = build({ storage: makeUserProviderStorage(rows) });

    const result = await controller.list(TARGET_USER_ID, {}, ctx({
      providerRoles: { [PROVIDER_P]: 'PROVIDER_ADMIN' },
    }));

    expect(storage.findByUserIdEnriched).toHaveBeenCalledWith(TARGET_USER_ID, [PROVIDER_P]);
    expect(result).toHaveLength(1);
    expect(result[0].providerId).toBe(PROVIDER_P);
  });

  it('rejects unauthenticated requests', async () => {
    const { controller } = build();
    await expect(controller.list(TARGET_USER_ID, {}, undefined)).rejects.toThrow(ForbiddenException);
  });

  it('returns empty list when non-super-admin has no admin providers', async () => {
    const { controller, storage } = build();
    const result = await controller.list(TARGET_USER_ID, {}, ctx({
      providerRoles: { [PROVIDER_P]: 'DIRECTOR' },
    }));
    expect(storage.findByUserIdEnriched).toHaveBeenCalledWith(TARGET_USER_ID, []);
    expect(result).toEqual([]);
  });
});

describe('UsersProvidersController.upsert', () => {
  it('upserts when editor is PROVIDER_ADMIN at target provider', async () => {
    const { controller, storage } = build();
    await controller.upsert(
      TARGET_USER_ID,
      PROVIDER_P,
      { providerRole: 'DIRECTOR' },
      {},
      ctx({ providerRoles: { [PROVIDER_P]: 'PROVIDER_ADMIN' } }),
    );
    expect(storage.upsert).toHaveBeenCalledWith({
      userId: TARGET_USER_ID,
      providerId: PROVIDER_P,
      providerRole: 'DIRECTOR',
    });
  });

  it('rejects when editor has no scope at target provider', async () => {
    const { controller } = build();
    await expect(
      controller.upsert(
        TARGET_USER_ID,
        PROVIDER_P,
        { providerRole: 'DIRECTOR' },
        {},
        ctx({ providerRoles: { [PROVIDER_OTHER]: 'PROVIDER_ADMIN' } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an unknown providerRole', async () => {
    const { controller } = build();
    await expect(
      controller.upsert(
        TARGET_USER_ID,
        PROVIDER_P,
        { providerRole: 'BOGUS' },
        {},
        ctx({ isSuperAdmin: true }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks demotion of the last PROVIDER_ADMIN at a provider', async () => {
    // Only one PROVIDER_ADMIN exists at PROVIDER_P, and the upsert is
    // demoting them — the last-admin guard should refuse with 409.
    const rows = [{ userId: TARGET_USER_ID, providerId: PROVIDER_P, providerRole: 'PROVIDER_ADMIN' }];
    const { controller } = build({ storage: makeUserProviderStorage(rows) });

    await expect(
      controller.upsert(
        TARGET_USER_ID,
        PROVIDER_P,
        { providerRole: 'DIRECTOR' },
        {},
        ctx({ isSuperAdmin: true }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('allows demotion when another PROVIDER_ADMIN remains', async () => {
    const rows = [
      { userId: TARGET_USER_ID, providerId: PROVIDER_P, providerRole: 'PROVIDER_ADMIN' },
      { userId: 'other-user', providerId: PROVIDER_P, providerRole: 'PROVIDER_ADMIN' },
    ];
    const { controller, storage } = build({ storage: makeUserProviderStorage(rows) });

    await controller.upsert(
      TARGET_USER_ID,
      PROVIDER_P,
      { providerRole: 'DIRECTOR' },
      {},
      ctx({ isSuperAdmin: true }),
    );
    expect(storage.upsert).toHaveBeenCalled();
  });
});

describe('UsersProvidersController.remove', () => {
  it('removes when editor is PROVIDER_ADMIN at target provider', async () => {
    const { controller, storage } = build();
    await controller.remove(
      TARGET_USER_ID,
      PROVIDER_P,
      {},
      ctx({ providerRoles: { [PROVIDER_P]: 'PROVIDER_ADMIN' } }),
    );
    expect(storage.remove).toHaveBeenCalledWith(TARGET_USER_ID, PROVIDER_P);
  });

  it('blocks removal of the last PROVIDER_ADMIN', async () => {
    const rows = [{ userId: TARGET_USER_ID, providerId: PROVIDER_P, providerRole: 'PROVIDER_ADMIN' }];
    const { controller } = build({ storage: makeUserProviderStorage(rows) });
    await expect(
      controller.remove(TARGET_USER_ID, PROVIDER_P, {}, ctx({ isSuperAdmin: true })),
    ).rejects.toThrow(ConflictException);
  });

  it('allows removing a DIRECTOR row even when target is the only DIRECTOR', async () => {
    const rows = [
      { userId: TARGET_USER_ID, providerId: PROVIDER_P, providerRole: 'DIRECTOR' },
      { userId: 'admin-user', providerId: PROVIDER_P, providerRole: 'PROVIDER_ADMIN' },
    ];
    const { controller, storage } = build({ storage: makeUserProviderStorage(rows) });
    await controller.remove(TARGET_USER_ID, PROVIDER_P, {}, ctx({ isSuperAdmin: true }));
    expect(storage.remove).toHaveBeenCalledWith(TARGET_USER_ID, PROVIDER_P);
  });
});
