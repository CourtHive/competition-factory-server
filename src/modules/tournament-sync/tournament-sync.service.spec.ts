import { TournamentSyncService } from './tournament-sync.service';
import { RelayConfig } from '../relay/relay.config';

// Minimal mock of TournamentStorageService
const mockStorageService = {
  saveTournamentRecord: jest.fn(),
  findTournamentRecord: jest.fn(),
  listTournamentIds: jest.fn(),
};

// Capture fetch calls
const originalFetch = global.fetch;

describe('TournamentSyncService', () => {
  const ORIGINAL = { ...process.env };
  let service: TournamentSyncService;
  let config: RelayConfig;

  beforeEach(() => {
    process.env.UPSTREAM_SERVER_URL = 'https://cloud.example.test';
    process.env.UPSTREAM_API_KEY = 'test-key-123';
    config = new RelayConfig();
    service = new TournamentSyncService(mockStorageService as any, config);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    global.fetch = originalFetch;
  });

  describe('listRemoteTournaments', () => {
    it('returns error when UPSTREAM_SERVER_URL not configured', async () => {
      delete process.env.UPSTREAM_SERVER_URL;
      const localConfig = new RelayConfig();
      const localService = new TournamentSyncService(mockStorageService as any, localConfig);

      let result: any = await localService.listRemoteTournaments();
      expect(result.error).toContain('not configured');
    });

    it('lists tournaments from upstream', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, tournamentIds: ['t1', 't2'] }),
      });

      let result: any = await service.listRemoteTournaments();
      expect(result.success).toBe(true);
      expect(result.tournamentIds).toEqual(['t1', 't2']);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://cloud.example.test/factory/tournaments',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key-123' }),
        }),
      );
    });

    it('returns error on upstream HTTP failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      let result: any = await service.listRemoteTournaments();
      expect(result.error).toContain('503');
    });

    it('returns error on network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      let result: any = await service.listRemoteTournaments();
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  describe('pullTournament', () => {
    const mockRecord = {
      tournamentId: 't1',
      tournamentName: 'INTENNSE Challenge',
      events: [],
    };

    it('returns error when UPSTREAM_SERVER_URL not configured', async () => {
      delete process.env.UPSTREAM_SERVER_URL;
      const localConfig = new RelayConfig();
      const localService = new TournamentSyncService(mockStorageService as any, localConfig);

      let result: any = await localService.pullTournament('t1');
      expect(result.error).toContain('not configured');
    });

    it('pulls and saves a tournament record', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, tournamentRecord: mockRecord }),
      });
      mockStorageService.saveTournamentRecord.mockResolvedValue({ success: true });

      let result: any = await service.pullTournament('t1');
      expect(result.success).toBe(true);
      expect(result.tournamentName).toBe('INTENNSE Challenge');
      expect(mockStorageService.saveTournamentRecord).toHaveBeenCalledWith({
        tournamentRecord: mockRecord,
      });
    });

    it('tracks sync status after successful pull', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, tournamentRecord: mockRecord }),
      });
      mockStorageService.saveTournamentRecord.mockResolvedValue({ success: true });

      await service.pullTournament('t1');

      const status = service.getTournamentSyncStatus('t1');
      expect(status).toBeDefined();
      expect(status?.tournamentName).toBe('INTENNSE Challenge');
      expect(status?.source).toBe('https://cloud.example.test');
    });

    it('returns error when upstream returns error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'Tournament not found' }),
      });

      let result: any = await service.pullTournament('t1');
      expect(result.error).toBe('Tournament not found');
      expect(mockStorageService.saveTournamentRecord).not.toHaveBeenCalled();
    });

    it('returns error when local save fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, tournamentRecord: mockRecord }),
      });
      mockStorageService.saveTournamentRecord.mockResolvedValue({ error: 'Storage full' });

      let result: any = await service.pullTournament('t1');
      expect(result.error).toBe('Storage full');
    });
  });

  describe('getSyncStatus', () => {
    it('returns empty array when no tournaments pulled', () => {
      expect(service.getSyncStatus()).toEqual([]);
    });

    it('accumulates status across multiple pulls', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            tournamentRecord: { tournamentId: 't1', tournamentName: 'T1' },
          }),
      });
      mockStorageService.saveTournamentRecord.mockResolvedValue({ success: true });

      await service.pullTournament('t1');
      expect(service.getSyncStatus()).toHaveLength(1);
    });
  });
});
