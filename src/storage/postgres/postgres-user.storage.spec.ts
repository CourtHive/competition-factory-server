// Unit tests for the HiveID Phase 1 PR-E additions to PostgresUserStorage.
// Mocks the pg Pool — no real Postgres connection. Mirrors the
// postgres-provisioner-api-key.storage.spec.ts pattern.
//
// Coverage is intentionally scoped to the NEW methods (`setPersonLink`,
// `getPersonLink`) — pre-existing methods (`findOne`, `create`, etc.) are
// out of scope; their behavior is unchanged by this PR.

import { IUserStorage } from '../interfaces/user-storage.interface';
import { PostgresUserStorage } from './postgres-user.storage';

function makeMockPool() {
  return { query: jest.fn() };
}

describe('PostgresUserStorage — HiveID PR-E additions', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: IUserStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresUserStorage(pool as any);
  });

  describe('setPersonLink', () => {
    it('writes all seven fields in a single UPDATE', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      const result = await storage.setPersonLink('u-1', {
        personId: 'p-9',
        personRevision: 3,
        cached: {
          standardFamilyName: 'Allen',
          standardGivenName: 'Charles',
          birthDate: '1975-01-01',
          sex: 'M',
          nationalityCode: 'USA',
        },
      });
      expect(result).toEqual({ success: true });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE users');
      expect(sql).toContain('SET person_id');
      expect(sql).toContain('person_revision');
      expect(sql).toContain('standard_family_name');
      expect(sql).toContain('standard_given_name');
      expect(sql).toContain('birth_date');
      expect(sql).toContain('sex');
      expect(sql).toContain('nationality_code');
      expect(sql).toContain('WHERE user_id = $1');
      expect(params).toEqual([
        'u-1',
        'p-9',
        3,
        'Allen',
        'Charles',
        '1975-01-01',
        'M',
        'USA',
      ]);
    });

    it('coerces missing cached fields to null', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      await storage.setPersonLink('u-2', {
        personId: 'p-10',
        personRevision: 1,
        cached: {
          standardGivenName: 'Onlygiven',
        },
      });
      const params = pool.query.mock.calls[0][1];
      expect(params).toEqual([
        'u-2',
        'p-10',
        1,
        null,
        'Onlygiven',
        null,
        null,
        null,
      ]);
    });

    it('stamps updated_at via NOW()', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      await storage.setPersonLink('u-3', {
        personId: 'p-11',
        personRevision: 1,
        cached: {},
      });
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('updated_at = NOW()');
    });
  });

  describe('getPersonLink', () => {
    it('returns the link + cached fields for an existing user', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          user_id: 'u-1',
          person_id: 'p-9',
          person_revision: 3,
          standard_family_name: 'Allen',
          standard_given_name: 'Charles',
          birth_date: new Date('1975-01-01'),
          sex: 'M',
          nationality_code: 'USA',
        }],
      });
      const result = await storage.getPersonLink('u-1');
      expect(result).toEqual({
        userId: 'u-1',
        personId: 'p-9',
        personRevision: 3,
        cached: {
          standardFamilyName: 'Allen',
          standardGivenName: 'Charles',
          birthDate: '1975-01-01',
          sex: 'M',
          nationalityCode: 'USA',
        },
      });
    });

    it('returns a null-shaped link for an unlinked user', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          user_id: 'u-2',
          person_id: null,
          person_revision: null,
          standard_family_name: null,
          standard_given_name: null,
          birth_date: null,
          sex: null,
          nationality_code: null,
        }],
      });
      const result = await storage.getPersonLink('u-2');
      expect(result).toEqual({
        userId: 'u-2',
        personId: null,
        personRevision: null,
        cached: {
          standardFamilyName: null,
          standardGivenName: null,
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
      });
    });

    it('returns null when the user does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      expect(await storage.getPersonLink('nope')).toBeNull();
    });

    it('selects the right columns', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.getPersonLink('u-x');
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('SELECT user_id, person_id, person_revision');
      expect(sql).toContain('standard_family_name');
      expect(sql).toContain('standard_given_name');
      expect(sql).toContain('birth_date');
      expect(sql).toContain('nationality_code');
      expect(sql).toContain('WHERE user_id = $1');
    });
  });

  describe('rewritePersonId', () => {
    it('updates rows matching the OLD person_id with the new id + revision + cached fields', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      const result = await storage.rewritePersonId({
        fromPersonId: 'old-1',
        toPersonId: 'new-1',
        personRevision: 5,
        cached: {
          standardFamilyName: 'Allen',
          standardGivenName: 'Charles',
          birthDate: '1975-01-01',
          sex: 'M',
          nationalityCode: 'USA',
        },
      });
      expect(result).toEqual({ rewrittenCount: 1 });
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE users');
      expect(sql).toContain('SET person_id = $1');
      expect(sql).toContain('person_revision = $2');
      expect(sql).toContain('WHERE person_id = $8');
      expect(params).toEqual([
        'new-1',
        5,
        'Allen',
        'Charles',
        '1975-01-01',
        'M',
        'USA',
        'old-1',
      ]);
    });

    it('returns rewrittenCount: 0 when no users had the old person_id', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      const result = await storage.rewritePersonId({
        fromPersonId: 'no-such',
        toPersonId: 'new',
        personRevision: 1,
        cached: {},
      });
      expect(result).toEqual({ rewrittenCount: 0 });
    });

    it('tolerates a null rowCount (returns 0)', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: null });
      const result = await storage.rewritePersonId({
        fromPersonId: 'x',
        toPersonId: 'y',
        personRevision: 1,
        cached: {},
      });
      expect(result).toEqual({ rewrittenCount: 0 });
    });

    it('coerces missing cached fields to null', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      await storage.rewritePersonId({
        fromPersonId: 'old',
        toPersonId: 'new',
        personRevision: 2,
        cached: { standardGivenName: 'OnlyGiven' },
      });
      const params = pool.query.mock.calls[0][1];
      expect(params).toEqual(['new', 2, null, 'OnlyGiven', null, null, null, 'old']);
    });
  });
});
