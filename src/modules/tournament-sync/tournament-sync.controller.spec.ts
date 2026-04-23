import { TournamentSyncController } from './tournament-sync.controller';

const mockSyncService = {
  listRemoteTournaments: jest.fn(),
  pullTournament: jest.fn(),
  getSyncStatus: jest.fn(),
};

describe('TournamentSyncController', () => {
  let controller: TournamentSyncController;

  beforeEach(() => {
    controller = new TournamentSyncController(mockSyncService as any);
    jest.clearAllMocks();
  });

  describe('listRemote', () => {
    it('delegates to syncService.listRemoteTournaments', async () => {
      mockSyncService.listRemoteTournaments.mockResolvedValue({
        success: true,
        tournamentIds: ['t1', 't2'],
      });

      let result: any = await controller.listRemote();
      expect(result.tournamentIds).toEqual(['t1', 't2']);
      expect(mockSyncService.listRemoteTournaments).toHaveBeenCalledTimes(1);
    });
  });

  describe('pullTournament', () => {
    it('pulls a tournament by id', async () => {
      mockSyncService.pullTournament.mockResolvedValue({
        success: true,
        tournamentName: 'Challenge',
      });

      let result: any = await controller.pullTournament({ tournamentId: 't1' });
      expect(result.success).toBe(true);
      expect(mockSyncService.pullTournament).toHaveBeenCalledWith('t1');
    });

    it('returns error when tournamentId missing', async () => {
      let result: any = await controller.pullTournament({} as any);
      expect(result.error).toContain('tournamentId required');
      expect(mockSyncService.pullTournament).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('returns sync status from service', () => {
      const status = [{ tournamentId: 't1', lastSyncedAt: '2026-04-19T00:00:00Z', source: 'https://cloud.test' }];
      mockSyncService.getSyncStatus.mockReturnValue(status);

      let result: any = controller.getSyncStatus();
      expect(result.success).toBe(true);
      expect(result.syncStatus).toEqual(status);
    });
  });
});
