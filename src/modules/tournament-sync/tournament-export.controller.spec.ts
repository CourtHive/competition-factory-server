import { UnauthorizedException } from '@nestjs/common';

import { TournamentExportController } from './tournament-export.controller';
import { RelayConfig } from '../relay/relay.config';

const mockStorageService = {
  findTournamentRecord: jest.fn(),
  listTournamentIds: jest.fn(),
};

describe('TournamentExportController', () => {
  const ORIGINAL = { ...process.env };
  let controller: TournamentExportController;

  beforeEach(() => {
    process.env.UPSTREAM_API_KEY = 'secret-key-abc';
    const config = new RelayConfig();
    controller = new TournamentExportController(mockStorageService as any, config);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  describe('listTournaments', () => {
    it('rejects missing auth', async () => {
      await expect(controller.listTournaments(undefined)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects invalid auth', async () => {
      await expect(controller.listTournaments('Bearer wrong-key')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lists tournaments with valid auth', async () => {
      mockStorageService.listTournamentIds.mockResolvedValue(['t1', 't2']);

      let result: any = await controller.listTournaments('Bearer secret-key-abc');
      expect(result.success).toBe(true);
      expect(result.tournamentIds).toEqual(['t1', 't2']);
    });
  });

  describe('exportTournament', () => {
    const mockRecord = { tournamentId: 't1', tournamentName: 'Test' };

    it('rejects missing auth', async () => {
      await expect(controller.exportTournament('t1', undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns tournament record with valid auth', async () => {
      mockStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: mockRecord,
      });

      let result: any = await controller.exportTournament('t1', 'Bearer secret-key-abc');
      expect(result.success).toBe(true);
      expect(result.tournamentRecord).toEqual(mockRecord);
    });

    it('returns error when tournament not found', async () => {
      mockStorageService.findTournamentRecord.mockResolvedValue({
        error: 'Tournament not found',
      });

      let result: any = await controller.exportTournament('missing', 'Bearer secret-key-abc');
      expect(result.error).toBe('Tournament not found');
    });
  });
});
