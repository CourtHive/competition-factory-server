import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock('./baseApi', () => ({
  baseApi: {
    post: (...args) => mockPost(...args),
    get: (...args) => mockGet(...args),
  },
}));

import { getDeletedDraws, restoreDeletedDraw } from './auditApi';

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
});

describe('auditApi', () => {
  describe('getDeletedDraws', () => {
    it('posts to /audit/deleted-draws with the tournamentId filter', async () => {
      mockPost.mockResolvedValue({
        data: {
          success: true,
          auditRows: [
            {
              auditId: 'a-1',
              tournamentId: 't-1',
              actionType: 'DELETE_DRAW',
              methods: [],
              status: 'applied',
              occurredAt: '2026-05-27T00:00:00Z',
              metadata: { drawId: 'd-1', eventId: 'e-1' },
            },
          ],
        },
      });
      const res = await getDeletedDraws({ tournamentId: 't-1' });
      expect(mockPost).toHaveBeenCalledWith('/audit/deleted-draws', { tournamentId: 't-1' });
      expect(res?.success).toBe(true);
      expect(res?.auditRows).toHaveLength(1);
      expect(res?.auditRows[0].metadata?.drawId).toBe('d-1');
    });

    it('passes optional eventId filter through', async () => {
      mockPost.mockResolvedValue({ data: { success: true, auditRows: [] } });
      await getDeletedDraws({ tournamentId: 't-1', eventId: 'e-1' });
      expect(mockPost).toHaveBeenCalledWith('/audit/deleted-draws', {
        tournamentId: 't-1',
        eventId: 'e-1',
      });
    });

    it('returns null when baseApi resolves to undefined (e.g. 401 swallowed by interceptor)', async () => {
      mockPost.mockResolvedValue(undefined);
      const res = await getDeletedDraws({ tournamentId: 't-1' });
      expect(res).toBeNull();
    });
  });

  describe('restoreDeletedDraw', () => {
    it('posts to /audit/restore-draw with the auditId', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, tournamentId: 't-1', eventId: 'e-1', drawId: 'd-1' },
      });
      const res = await restoreDeletedDraw('a-1');
      expect(mockPost).toHaveBeenCalledWith('/audit/restore-draw', { auditId: 'a-1' });
      expect(res?.success).toBe(true);
      expect(res?.drawId).toBe('d-1');
    });

    it('surfaces server-side error codes (e.g. ALREADY_RESTORED)', async () => {
      mockPost.mockResolvedValue({
        data: { error: 'ALREADY_RESTORED', tournamentId: 't-1', drawId: 'd-1' },
      });
      const res = await restoreDeletedDraw('a-1');
      expect(res?.error).toBe('ALREADY_RESTORED');
      expect(res?.success).toBeUndefined();
    });

    it('returns null when baseApi resolves to undefined', async () => {
      mockPost.mockResolvedValue(undefined);
      const res = await restoreDeletedDraw('a-1');
      expect(res).toBeNull();
    });
  });
});
