import { BadRequestException, NotFoundException } from '@nestjs/common';

import { BoltHistoryController } from './bolt-history.controller';
import { BoltHistoryDocument } from 'src/storage/interfaces/bolt-history.interface';
import { BoltHistoryService } from './bolt-history.service';

const buildDocument = (overrides: Partial<BoltHistoryDocument> = {}): BoltHistoryDocument => ({
  tieMatchUpId: 'tie-1',
  parentMatchUpId: 'parent-1',
  tournamentId: 'tour-1',
  sides: [],
  engineState: {},
  boltStarted: false,
  boltExpired: false,
  boltComplete: false,
  timeoutsUsed: { 1: 0, 2: 0 },
  pausedOnExit: false,
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
  version: 0,
  ...overrides,
});

describe('BoltHistoryController', () => {
  let service: jest.Mocked<BoltHistoryService>;
  let controller: BoltHistoryController;

  beforeEach(() => {
    service = {
      find: jest.fn(),
      listForTournament: jest.fn(),
      upsert: jest.fn(),
      remove: jest.fn(),
      getParentMatchUp: jest.fn(),
    } as any;
    controller = new BoltHistoryController(service);
  });

  describe('find', () => {
    it('returns the document when found', async () => {
      service.find.mockResolvedValue({ document: buildDocument({ version: 7 }) });
      const result = await controller.find('tie-1');
      expect(result.document?.version).toBe(7);
    });

    it('throws NotFound when missing', async () => {
      service.find.mockResolvedValue({ error: 'Bolt history not found' });
      await expect(controller.find('tie-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest on other errors', async () => {
      service.find.mockResolvedValue({ error: 'something else' });
      await expect(controller.find('tie-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listForTournament', () => {
    it('rejects missing tournamentId', async () => {
      await expect(controller.listForTournament(undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns documents on success', async () => {
      service.listForTournament.mockResolvedValue({ documents: [buildDocument(), buildDocument()] });
      const result = await controller.listForTournament('tour-1');
      expect(result.documents).toHaveLength(2);
    });

    it('returns empty array when storage returns no documents', async () => {
      service.listForTournament.mockResolvedValue({});
      const result = await controller.listForTournament('tour-1');
      expect(result.documents).toEqual([]);
    });
  });

  describe('upsert', () => {
    it('rejects when body lacks document', async () => {
      await expect(controller.upsert('tie-1', {} as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects URL/body tieMatchUpId mismatch', async () => {
      await expect(
        controller.upsert('tie-1', { document: buildDocument({ tieMatchUpId: 'tie-2' }) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns success + version on accept', async () => {
      service.upsert.mockResolvedValue({ success: true, version: 4 });
      const result = await controller.upsert('tie-1', { document: buildDocument() });
      expect(result).toEqual({ success: true, version: 4 });
    });

    it('returns VERSION_CONFLICT result without throwing', async () => {
      service.upsert.mockResolvedValue({ error: 'VERSION_CONFLICT' });
      const result = await controller.upsert('tie-1', { document: buildDocument() });
      expect(result).toEqual({ success: false, error: 'VERSION_CONFLICT' });
    });

    it('throws BadRequest on other errors', async () => {
      service.upsert.mockResolvedValue({ error: 'database exploded' });
      await expect(
        controller.upsert('tie-1', { document: buildDocument() }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('returns success when storage acks', async () => {
      service.remove.mockResolvedValue({ success: true });
      const result = await controller.remove('tie-1');
      expect(result).toEqual({ success: true });
    });

    it('throws BadRequest on storage error', async () => {
      service.remove.mockResolvedValue({ error: 'nope' });
      await expect(controller.remove('tie-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('parentMatchUp', () => {
    it('returns the team matchUp on success', async () => {
      const teamMatchUp = { matchUpId: 'parent-1', matchUpType: 'TEAM' };
      service.getParentMatchUp.mockResolvedValue({ teamMatchUp });
      const result = await controller.parentMatchUp('tie-1');
      expect(result).toEqual({ teamMatchUp });
    });

    it('throws NotFound when bolt history is missing', async () => {
      service.getParentMatchUp.mockResolvedValue({ error: 'Bolt history not found' });
      await expect(controller.parentMatchUp('tie-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when parent matchUp cannot be located in the tournament', async () => {
      service.getParentMatchUp.mockResolvedValue({ error: 'Parent matchUp not found in tournament' });
      await expect(controller.parentMatchUp('tie-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest on other errors', async () => {
      service.getParentMatchUp.mockResolvedValue({ error: 'engine exploded' });
      await expect(controller.parentMatchUp('tie-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
