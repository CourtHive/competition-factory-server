import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { factoryConstants } from 'tods-competition-factory';
import fileStorage from '../../../../services/fileSystem';
import { testTournamentId } from '../../../../common/constants/test';

const tournamentId = testTournamentId(__filename);
import { executionQueue, attachProviderPolicies } from './executionQueue';
import 'dotenv/config';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

// Minimal mock that delegates to fileStorage for test purposes
const mockStorage = {
  fetchTournamentRecords: (params) => fileStorage.fetchTournamentRecords(params),
  saveTournamentRecords: (params) => fileStorage.saveTournamentRecords(params),
  modifyProviderCalendar: () => Promise.resolve({ success: true }),
} as unknown as TournamentStorageService;

const testUser = { providerId: 'test-provider', roles: ['superadmin'] };

describe('executionQueue', () => {
  it('can generate a tournamentRecord', async () => {
    // FIRST: remove any existing tournamentRecord with this tournamentId
    let result: any = await removeTournamentRecords({ tournamentId });
    expect(result.success).toEqual(true);

    // SECOND: generate a tournamentRecord with this tournamentId and persist to storage
    result = await generateTournamentRecord(
      {
        tournamentAttributes: { tournamentId },
        drawProfiles: [{ drawSize: 16 }],
      },
      testUser,
    );
    expect(result.success).toEqual(true);

    const payload = {
      methods: [
        {
          method: 'setTournamentDates',
          params: {
            startDate: '2024-01-01',
            endDate: '2024-01-02',
            tournamentId,
          },
        },
      ],
      tournamentIds: [tournamentId, 'test2'],
    };

    // THIRD: execute a directive on the tournamentRecord
    result = await executionQueue(payload, undefined, mockStorage);
    expect(result.success).toEqual(true);

    // FOURTH: attempt to execute a directive on a tournamentRecord that does not exist
    result = await executionQueue({
      methods: [{ method: 'setTournamentDates', params: { tournamentId } }],
      tournamentIds: ['doesNotExist'],
    }, undefined, mockStorage);
    expect(result.error).toEqual(factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD);
  });

  it('records the factory error CODE (not "[object Object]") on a rejected mutation', async () => {
    await removeTournamentRecords({ tournamentId });
    const gen: any = await generateTournamentRecord(
      { tournamentAttributes: { tournamentId }, drawProfiles: [{ drawSize: 8 }] },
      testUser,
    );
    expect(gen.success).toEqual(true);

    const recordMutation = vi.fn().mockResolvedValue(undefined);
    const auditService = { recordMutation } as any;

    // Schedule against a non-existent draw → the engine returns an
    // object-shaped factory error ({ message, code }). Pre-fix the audit
    // hook String()'d the object to the useless literal "[object Object]".
    const payload = {
      methods: [
        {
          method: 'addMatchUpScheduleItems',
          params: {
            drawId: 'no-such-draw',
            matchUpId: 'no-such-matchup',
            schedule: { scheduledDate: '2024-01-01' },
            tournamentId,
          },
        },
      ],
      tournamentIds: [tournamentId],
      rollbackOnError: true,
    };

    const result: any = await executionQueue(payload, undefined, mockStorage, auditService);
    expect(result.success).not.toBe(true);
    expect(recordMutation).toHaveBeenCalledTimes(1);
    const recorded = recordMutation.mock.calls[0][0];
    expect(recorded.status).toBe('rejected');
    expect(typeof recorded.errorCode).toBe('string');
    expect(recorded.errorCode).not.toBe('[object Object]');
    expect(recorded.errorCode.startsWith('ERR_')).toBe(true);
  });
});

describe('attachProviderPolicies (privacy attach hook)', () => {
  const PROVIDER_ID = 'priv-provider-1';
  const privacyPolicy = { policyName: 'Test Privacy', participant: { person: { addresses: false } } };

  // A provider whose effective config exposes the selected privacy policy.
  const providerStorage: any = {
    getProvider: vi.fn().mockResolvedValue({
      providerConfigCaps: {},
      providerConfigSettings: { participantPrivacyPolicy: privacyPolicy },
    }),
  };

  // Minimal mutationEngine stub: state carries one provider-owned record;
  // executionQueue records the methods it is asked to apply.
  function makeEngine(record: any) {
    const applied: any[] = [];
    return {
      applied,
      getState: () => ({ tournamentRecords: { [tournamentId]: record } }),
      executionQueue: vi.fn(async (methods: any[]) => {
        applied.push(...methods);
        return { success: true };
      }),
    };
  }

  const newTournamentMethods = [{ method: 'newTournamentRecord', params: {} }];

  beforeEach(() => vi.clearAllMocks());

  it('attaches the provider privacy policy on new-tournament creation and returns the method for client replay', async () => {
    const engine = makeEngine({ tournamentId, parentOrganisation: { organisationId: PROVIDER_ID } });
    const applied = await attachProviderPolicies({
      methods: newTournamentMethods,
      tournamentIds: [tournamentId],
      mutationEngine: engine,
      providerStorage,
    });

    expect(providerStorage.getProvider).toHaveBeenCalledWith(PROVIDER_ID);
    expect(applied).toHaveLength(1);
    expect(applied[0].method).toBe('attachPolicies');
    expect(applied[0].params.tournamentId).toBe(tournamentId);
    expect(applied[0].params.policyDefinitions[POLICY_TYPE_PARTICIPANT]).toEqual(privacyPolicy);
    // The engine was actually asked to apply the attach (persisted before save).
    expect(engine.executionQueue).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the batch contains no newTournamentRecord', async () => {
    const engine = makeEngine({ tournamentId, parentOrganisation: { organisationId: PROVIDER_ID } });
    const applied = await attachProviderPolicies({
      methods: [{ method: 'setTournamentDates', params: {} }],
      tournamentIds: [tournamentId],
      mutationEngine: engine,
      providerStorage,
    });
    expect(applied).toEqual([]);
    expect(providerStorage.getProvider).not.toHaveBeenCalled();
    expect(engine.executionQueue).not.toHaveBeenCalled();
  });

  it('is a no-op when the provider has no privacy policy configured', async () => {
    const bareProviderStorage: any = {
      getProvider: vi.fn().mockResolvedValue({ providerConfigCaps: {}, providerConfigSettings: {} }),
    };
    const engine = makeEngine({ tournamentId, parentOrganisation: { organisationId: PROVIDER_ID } });
    const applied = await attachProviderPolicies({
      methods: newTournamentMethods,
      tournamentIds: [tournamentId],
      mutationEngine: engine,
      providerStorage: bareProviderStorage,
    });
    expect(applied).toEqual([]);
    expect(engine.executionQueue).not.toHaveBeenCalled();
  });

  it('skips records with no owning provider (no parentOrganisation)', async () => {
    const engine = makeEngine({ tournamentId });
    const applied = await attachProviderPolicies({
      methods: newTournamentMethods,
      tournamentIds: [tournamentId],
      mutationEngine: engine,
      providerStorage,
    });
    expect(applied).toEqual([]);
    expect(providerStorage.getProvider).not.toHaveBeenCalled();
  });

  it('fail-soft: a provider-lookup error never throws and yields no applied methods', async () => {
    const throwingStorage: any = { getProvider: vi.fn().mockRejectedValue(new Error('db down')) };
    const engine = makeEngine({ tournamentId, parentOrganisation: { organisationId: PROVIDER_ID } });
    const applied = await attachProviderPolicies({
      methods: newTournamentMethods,
      tournamentIds: [tournamentId],
      mutationEngine: engine,
      providerStorage: throwingStorage,
    });
    expect(applied).toEqual([]);
    expect(engine.executionQueue).not.toHaveBeenCalled();
  });

  it('returns nothing when providerStorage is not injected', async () => {
    const engine = makeEngine({ tournamentId, parentOrganisation: { organisationId: PROVIDER_ID } });
    const applied = await attachProviderPolicies({
      methods: newTournamentMethods,
      tournamentIds: [tournamentId],
      mutationEngine: engine,
      providerStorage: undefined,
    });
    expect(applied).toEqual([]);
  });
});
