/**
 * HiveIDTournamentService — the SPLIT tournament methods (getClaimableForTournament
 * / claimParticipant). getMyParticipations was removed from CFS — it moved to the
 * courthive-query service (pure read-model SQL, no record scan).
 */
import { HiveIDTournamentService } from './hiveid-tournament.service';

describe('HiveIDTournamentService', () => {
  let service: HiveIDTournamentService;
  let mockUserStorage: any;
  let mockTournamentStorageService: any;
  let mockAuditService: any;

  beforeEach(() => {
    mockUserStorage = {
      getPersonLink: jest.fn().mockResolvedValue(null),
    };
    mockTournamentStorageService = {
      findTournamentRecord: jest.fn().mockResolvedValue({ tournamentRecord: null }),
    };
    mockAuditService = {};

    service = new HiveIDTournamentService(mockTournamentStorageService, mockAuditService, mockUserStorage);
  });

  describe('getClaimableForTournament', () => {
    it('returns candidates with overlapping names', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          participants: [
            {
              participantId: 'pa-1',
              participantName: 'Jane Doe',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Jane',
                standardFamilyName: 'Doe',
                sex: 'F',
                nationalityCode: 'USA',
                personOtherIds: [],
              },
            },
            {
              participantId: 'pa-2',
              participantName: 'Bob Smith',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Bob',
                standardFamilyName: 'Smith',
                personOtherIds: [],
              },
            },
            // Already linked → excluded.
            {
              participantId: 'pa-3',
              participantName: 'Jane Doe',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Jane',
                standardFamilyName: 'Doe',
                personOtherIds: [{ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }],
              },
            },
          ],
        },
      });

      const result = await service.getClaimableForTournament('u-1', 't-1');
      expect(result.tournamentId).toBe('t-1');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].participantId).toBe('pa-1');
      expect(result.candidates[0].alreadyLinkedTo).toBeNull();
    });

    it('returns empty when user has no cached canonical name', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: null,
        personRevision: null,
        cached: { standardFamilyName: null, standardGivenName: null, birthDate: null, sex: null, nationalityCode: null },
        consentPreferences: {},
      });
      const result = await service.getClaimableForTournament('u-1', 't-1');
      expect(result).toEqual({ tournamentId: 't-1', candidates: [] });
      expect(mockTournamentStorageService.findTournamentRecord).not.toHaveBeenCalled();
    });

    it('rejects an empty tournamentId', async () => {
      await expect(service.getClaimableForTournament('u-1', '')).rejects.toThrow(/tournamentId/);
    });
  });

  describe('claimParticipant', () => {
    function setupClaimable(): void {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          participants: [
            {
              participantId: 'pa-1',
              participantName: 'Jane Doe',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Jane',
                standardFamilyName: 'Doe',
                personOtherIds: [],
              },
            },
          ],
        },
      });
    }

    it('rejects when the user has no canonical link', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: null,
        personRevision: null,
        cached: { standardFamilyName: null, standardGivenName: null, birthDate: null, sex: null, nationalityCode: null },
        consentPreferences: {},
      });
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: 'pa-1' }),
      ).rejects.toThrow(/canonical link/);
    });

    it('rejects when the tournament does not exist', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: null });
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: 'pa-1' }),
      ).rejects.toThrow(/Tournament not found/);
    });

    it('rejects when the canonical name does not overlap', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          participants: [
            {
              participantId: 'pa-1',
              participantName: 'Bob Smith',
              participantType: 'INDIVIDUAL',
              person: { standardGivenName: 'Bob', standardFamilyName: 'Smith', personOtherIds: [] },
            },
          ],
        },
      });
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: 'pa-1' }),
      ).rejects.toThrow(/canonical name/);
    });

    it('requires tournamentId + participantId', async () => {
      setupClaimable();
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: '', participantId: 'pa-1' }),
      ).rejects.toThrow(/required/);
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: '' }),
      ).rejects.toThrow(/required/);
    });
  });
});
