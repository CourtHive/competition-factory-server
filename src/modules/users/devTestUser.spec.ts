import { TEST_EMAIL, TEST_PASSWORD, TEST_USER_ID } from 'src/common/constants/test';
import { devTestUserDecision } from './devTestUser';
import { UsersService } from './users.service';

const DEV_LOCAL = { APP_MODE: 'development', NODE_ENV: 'test', PG_HOST: '127.0.0.1' };

describe('devTestUserDecision', () => {
  it('allows the dev super-admin only in development mode against a loopback database', () => {
    expect(devTestUserDecision(DEV_LOCAL).allowed).toBe(true);
    expect(devTestUserDecision({ ...DEV_LOCAL, PG_HOST: 'localhost' }).allowed).toBe(true);
    expect(devTestUserDecision({ ...DEV_LOCAL, PG_HOST: '::1' }).allowed).toBe(true);
    // getPostgresConfig() defaults an unset host to localhost, so this must agree with it.
    expect(devTestUserDecision({ APP_MODE: 'development' }).allowed).toBe(true);
  });

  it('refuses it outside development mode, without calling that a refusal', () => {
    expect(devTestUserDecision({ ...DEV_LOCAL, APP_MODE: 'staging' })).toEqual({ allowed: false });
    expect(devTestUserDecision({ ...DEV_LOCAL, APP_MODE: undefined })).toEqual({ allowed: false });
  });

  it('refuses it against a database on another host', () => {
    // A shared host: development mode, development NODE_ENV, a database reached over the network.
    const result = devTestUserDecision({ APP_MODE: 'development', NODE_ENV: 'development', PG_HOST: '10.128.0.4' });
    expect(result.allowed).toBe(false);
    expect(result.refusedBecause).toContain('10.128.0.4');
  });

  it('refuses it over a Unix socket, which is how production connects', () => {
    expect(devTestUserDecision({ ...DEV_LOCAL, PG_HOST: '/var/run/postgresql' }).allowed).toBe(false);
  });

  it('refuses it when NODE_ENV is production, whatever the database', () => {
    expect(devTestUserDecision({ ...DEV_LOCAL, NODE_ENV: 'production' }).allowed).toBe(false);
  });
});

describe('UsersService honours the decision', () => {
  const storageRow = { email: TEST_EMAIL, password: 'hash-from-a-real-row' };
  const userStorage: any = { findOne: vi.fn(async () => storageRow) };
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    userStorage.findOne.mockClear();
  });

  const serviceWith = (env: Record<string, string>) => {
    process.env = { ...saved, ...env };
    return new UsersService(userStorage);
  };

  it('offers the in-memory dev user when allowed', async () => {
    const service = serviceWith(DEV_LOCAL);
    const user: any = await service.findOne(TEST_EMAIL);
    expect(user.password).toBe(TEST_PASSWORD);
    expect(userStorage.findOne).not.toHaveBeenCalled();
    expect(service.getDevUserById(TEST_USER_ID)?.email).toBe(TEST_EMAIL);
  });

  it('goes to storage instead when the database is not local', async () => {
    const service = serviceWith({ APP_MODE: 'development', NODE_ENV: 'development', PG_HOST: '10.128.0.4' });
    const user: any = await service.findOne(TEST_EMAIL);
    // The control: the published password must not come back from anywhere but a real row.
    expect(user).toBe(storageRow);
    expect(userStorage.findOne).toHaveBeenCalledWith(TEST_EMAIL);
    expect(service.getDevUserById(TEST_USER_ID)).toBeNull();
  });
});
