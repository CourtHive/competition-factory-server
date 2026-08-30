import type { Mock } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AvailabilityPullService } from './availability-pull.service';

vi.mock('../../factory/functions/private/executionQueue', () => ({
  executionQueue: vi.fn(),
}));
vi.mock('../../factory/helpers/checkTournamentAccess', () => ({
  canMutateTournament: vi.fn(),
}));

// vi.mock is hoisted above the imports, so these imports receive the mocks. jest needed
// require() here because its module registry was populated after the import bindings.
import { canMutateTournament } from '../../factory/helpers/checkTournamentAccess';
import { executionQueue } from '../../factory/functions/private/executionQueue';

// The imports above resolve to the vi.mock factories at runtime; the casts tell the type
// system that. jest's require() returned `any`, which hid this.
const mockExecutionQueue = executionQueue as unknown as Mock;
const mockCanMutate = canMutateTournament as unknown as Mock;

const USER_CONTEXT: any = { userId: 'u1', email: 'director@example.com', providerRoles: {}, providerIds: ['PROV1'] };
const TOURNAMENT_ID = 't1';

function seededRecord(): any {
  return {
    parentOrganisation: { organisationId: 'PROV1' },
    startDate: '2026-08-10',
    endDate: '2026-08-12',
    participants: [{ person: { personOtherIds: [{ organisationId: 'CANONICAL_PERSON', personId: 'p1' }] } }],
  };
}

describe('AvailabilityPullService', () => {
  let service: AvailabilityPullService;
  let tournamentStorageService: any;
  let assignmentsService: any;
  let auditService: any;
  let declarationsClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanMutate.mockReturnValue(true);
    tournamentStorageService = { findTournamentRecord: vi.fn().mockResolvedValue({ tournamentRecord: seededRecord() }) };
    assignmentsService = {
      getAssignedTournamentIds: vi.fn().mockResolvedValue(new Set<string>()),
      getAssignedRoles: vi.fn().mockResolvedValue(new Map<string, string>()),
    };
    auditService = { recordMutation: vi.fn() };
    declarationsClient = { getAvailability: vi.fn(), isDisabled: vi.fn().mockReturnValue(false) };
    service = new AvailabilityPullService(tournamentStorageService, assignmentsService, auditService, declarationsClient);
  });

  it('rejects when the user cannot mutate the tournament', async () => {
    mockCanMutate.mockReturnValue(false);
    await expect(service.pull({ userContext: USER_CONTEXT, tournamentId: TOURNAMENT_ID })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(declarationsClient.getAvailability).not.toHaveBeenCalled();
    expect(mockExecutionQueue).not.toHaveBeenCalled();
  });

  it('applies DO_NOT_SCHEDULE via executionQueue for UNAVAILABLE days', async () => {
    declarationsClient.getAvailability.mockResolvedValue([
      { personId: 'p1', payload: { span: { from: '2026-08-10', to: '2026-08-12' }, days: { '2026-08-11': 'UNAVAILABLE' } } },
    ]);
    mockExecutionQueue.mockResolvedValue({ success: true });

    const result = await service.pull({ userContext: USER_CONTEXT, tournamentId: TOURNAMENT_ID });

    expect(declarationsClient.getAvailability).toHaveBeenCalledWith(['p1'], 'PROV1');
    const [payload] = mockExecutionQueue.mock.calls[0];
    expect(payload.tournamentIds).toEqual([TOURNAMENT_ID]);
    expect(payload.methods).toEqual([
      {
        method: 'addPersonRequests',
        params: {
          personId: 'p1',
          requests: [{ date: '2026-08-11', startTime: '00:00', endTime: '23:59', requestType: 'DO_NOT_SCHEDULE' }],
        },
      },
    ]);
    expect(result).toEqual({ personsWithRequests: 1, requestsAdded: 1, ifNeeded: {}, applied: true });
  });

  it('does not touch executionQueue when no one is UNAVAILABLE', async () => {
    declarationsClient.getAvailability.mockResolvedValue([
      { personId: 'p1', payload: { span: { from: '2026-08-10', to: '2026-08-12' }, days: { '2026-08-11': 'AVAILABLE' } } },
    ]);
    const result = await service.pull({ userContext: USER_CONTEXT, tournamentId: TOURNAMENT_ID });
    expect(mockExecutionQueue).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
  });

  it('short-circuits when the tournament has no canonical participants', async () => {
    tournamentStorageService.findTournamentRecord.mockResolvedValue({
      tournamentRecord: { parentOrganisation: { organisationId: 'PROV1' }, startDate: '2026-08-10', endDate: '2026-08-12', participants: [] },
    });
    const result = await service.pull({ userContext: USER_CONTEXT, tournamentId: TOURNAMENT_ID });
    expect(declarationsClient.getAvailability).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
  });

  it('throws when the tournament has no provider association', async () => {
    tournamentStorageService.findTournamentRecord.mockResolvedValue({
      tournamentRecord: { startDate: '2026-08-10', endDate: '2026-08-12', participants: [] },
    });
    await expect(service.pull({ userContext: USER_CONTEXT, tournamentId: TOURNAMENT_ID })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('surfaces an executionQueue failure as a BadRequest', async () => {
    declarationsClient.getAvailability.mockResolvedValue([
      { personId: 'p1', payload: { span: { from: '2026-08-10', to: '2026-08-12' }, days: { '2026-08-11': 'UNAVAILABLE' } } },
    ]);
    mockExecutionQueue.mockResolvedValue({ error: 'boom' });
    await expect(service.pull({ userContext: USER_CONTEXT, tournamentId: TOURNAMENT_ID })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
