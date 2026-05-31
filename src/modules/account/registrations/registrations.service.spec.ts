import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { RegistrationsService } from './registrations.service';

describe('RegistrationsService', () => {
  let service: RegistrationsService;
  let storage: any;
  let userStorage: any;
  let tournamentStorageService: any;

  const NOW = new Date('2026-06-01T12:00:00Z');
  const OPEN_PROFILE = {
    entriesOpen: '2026-05-01T00:00:00Z',
    entriesClose: '2026-06-10T00:00:00Z',
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    storage = {
      applyForTournament: jest.fn(),
      findById: jest.fn(),
      listByUser: jest.fn(),
      listByTournament: jest.fn(),
      updateStatus: jest.fn(),
    };
    userStorage = {
      getPersonLink: jest.fn().mockResolvedValue(null),
    };
    tournamentStorageService = {
      findTournamentRecord: jest.fn(),
    };
    service = new RegistrationsService(storage, userStorage, tournamentStorageService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('apply', () => {
    it('rejects without userId', async () => {
      await expect(
        service.apply({ userId: '', tournamentId: 't-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects without tournamentId', async () => {
      await expect(
        service.apply({ userId: 'u-1', tournamentId: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the tournament is not found', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: null });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/Tournament not found/);
    });

    it('rejects when no registrationProfile is published', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: { tournamentId: 't-1' },
      });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/registration window/);
    });

    it('rejects when entries are closed', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          registrationProfile: { entriesOpen: '2026-04-01', entriesClose: '2026-05-30T00:00:00Z' },
          events: [],
        },
      });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/closed/);
    });

    it('rejects when entries have not opened yet', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          registrationProfile: { entriesOpen: '2026-08-01T00:00:00Z' },
          events: [],
        },
      });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/have not opened/);
    });

    it('upserts via storage with the HiveID personId attached when linked', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          registrationProfile: OPEN_PROFILE,
          events: [{ eventId: 'e-1' }, { eventId: 'e-2' }],
        },
      });
      userStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {},
        consentPreferences: {},
      });
      storage.applyForTournament.mockResolvedValue({ registrationId: 'r-1' });

      await service.apply({
        userId: 'u-1',
        tournamentId: 't-1',
        eventIds: ['e-1', 'e-2', 'unknown-event'],
        partnerUserId: 'u-2',
        answers: { handedness: 'right' },
      });

      expect(storage.applyForTournament).toHaveBeenCalledWith({
        tournamentId: 't-1',
        userId: 'u-1',
        personId: 'p-canon',
        eventIds: ['e-1', 'e-2'],
        partnerUserId: 'u-2',
        answers: { handedness: 'right' },
      });
    });

    it('passes a null personId when the user has no canonical link', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: { tournamentId: 't-1', registrationProfile: OPEN_PROFILE, events: [] },
      });
      storage.applyForTournament.mockResolvedValue({ registrationId: 'r-1' });
      await service.apply({ userId: 'u-1', tournamentId: 't-1' });
      const call = storage.applyForTournament.mock.calls[0][0];
      expect(call.personId).toBeNull();
    });
  });

  describe('listForUser', () => {
    it('rejects without userId', async () => {
      await expect(service.listForUser('')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns the storage list', async () => {
      storage.listByUser.mockResolvedValue([{ registrationId: 'r-1' }]);
      const result = await service.listForUser('u-1');
      expect(result).toEqual([{ registrationId: 'r-1' }]);
      expect(storage.listByUser).toHaveBeenCalledWith('u-1');
    });
  });

  describe('withdraw', () => {
    it('rejects on missing args', async () => {
      await expect(service.withdraw('', 'r-1')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.withdraw('u-1', '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the registration belongs to a different user', async () => {
      storage.findById.mockResolvedValue({ registrationId: 'r-1', userId: 'someone-else', status: 'applied' });
      await expect(service.withdraw('u-1', 'r-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('idempotently returns the row when already withdrawn', async () => {
      const existing = { registrationId: 'r-1', userId: 'u-1', status: 'withdrawn' };
      storage.findById.mockResolvedValue(existing);
      const result = await service.withdraw('u-1', 'r-1');
      expect(result).toBe(existing);
      expect(storage.updateStatus).not.toHaveBeenCalled();
    });

    it('calls updateStatus with the applicant-initiated reason', async () => {
      storage.findById.mockResolvedValue({ registrationId: 'r-1', userId: 'u-1', status: 'applied' });
      storage.updateStatus.mockResolvedValue({ registrationId: 'r-1', status: 'withdrawn' });
      const result = await service.withdraw('u-1', 'r-1');
      expect(storage.updateStatus).toHaveBeenCalledWith({
        registrationId: 'r-1',
        status: 'withdrawn',
        decidedByUserId: 'u-1',
        statusReason: 'applicant-initiated',
      });
      expect(result.status).toBe('withdrawn');
    });
  });
});
