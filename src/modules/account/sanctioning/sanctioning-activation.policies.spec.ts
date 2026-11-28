import * as factory from 'tods-competition-factory';

import { generateTournamentRecord } from 'src/modules/factory/helpers/generateTournamentRecord';
import { attachSanctionedPolicies, pinnedPolicyValue, storeActivatedTournament } from './sanctioning-activation';

// What a sanctioned tournament carries from sanctioning, and what every tournament CFS creates says about the defaults
// it relies on. AMS pins a policy only when it differs from the factory default; it travels with its catalogue name,
// version and source, and the factory keeps them on the pinned value. A factory that exports `defaultsHash` stamps
// every tournament it creates with it; with one that does not, nothing is stamped and nothing here depends on it.

const stamps = typeof (factory as any).defaultsHash === 'string';
const logger = (): any => ({ log: vi.fn(), warn: vi.fn() });

const progression = {
  policyType: 'progression',
  name: 'USTA_PROGRESSION',
  version: '1.0.0',
  definition: { doubleExitPropagateBye: false, autoPlaceQualifiers: false },
  sourceId: 'usta',
  sourceRole: 'SANCTIONING_POLICY',
};

describe('pinnedPolicyValue', () => {
  it('pins the full definition with its name, version and source', () => {
    expect(pinnedPolicyValue(progression)).toEqual({
      doubleExitPropagateBye: false,
      autoPlaceQualifiers: false,
      policyName: 'USTA_PROGRESSION',
      policyVersion: '1.0.0',
      policySource: { sourceId: 'usta', sourceRole: 'SANCTIONING_POLICY' },
    });
  });

  it("names the policy by AMS's catalogue entry, over a descriptive name inside the definition", () => {
    const value = pinnedPolicyValue({ ...progression, definition: { policyName: 'Progression', x: 1 } });
    expect(value.policyName).toBe('USTA_PROGRESSION');
  });

  it('adds no provenance to an empty definition, which the factory still refuses', () => {
    expect(pinnedPolicyValue({ ...progression, definition: {} })).toEqual({});
    const tournamentRecord: any = { tournamentId: 't-empty' };
    const log = logger();
    attachSanctionedPolicies(
      tournamentRecord,
      { sanctioningId: 's', attachedPolicies: [{ ...progression, definition: {} }] } as any,
      log,
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not attach sanctioned policies'));
    expect(factory.policyGovernor.getAppliedPolicies({ tournamentRecord }).appliedPolicies).toEqual({});
  });

  it('leaves out what AMS did not send, never inventing it', () => {
    const value = pinnedPolicyValue({ policyType: 'seeding', definition: { duplicateSeedNumbers: false } } as any);
    expect(value).toEqual({ duplicateSeedNumbers: false });
  });
});

describe('attachSanctionedPolicies', () => {
  it('attaches each policy with its provenance, and the factory keeps it', () => {
    const tournamentRecord: any = { tournamentId: 't-pinned' };
    const sanctioningRecord: any = { sanctioningId: 's', attachedPolicies: [progression] };
    attachSanctionedPolicies(tournamentRecord, sanctioningRecord, logger());

    const { appliedPolicies } = factory.policyGovernor.getAppliedPolicies({ tournamentRecord }) as any;
    expect(appliedPolicies.progression).toEqual(pinnedPolicyValue(progression));
  });

  it('attaches nothing when nothing differed, and leaves the record as it was', () => {
    const tournamentRecord: any = { tournamentId: 't-none' };
    attachSanctionedPolicies(tournamentRecord, { sanctioningId: 's', attachedPolicies: [] } as any, logger());
    expect(tournamentRecord).toEqual({ tournamentId: 't-none' });
  });

  it.runIf(stamps)('stamps the defaults onto a record that took a policy and carried no stamp', () => {
    const tournamentRecord: any = { tournamentId: 't-stamp' };
    attachSanctionedPolicies(
      tournamentRecord,
      { sanctioningId: 's', attachedPolicies: [progression] } as any,
      logger(),
    );
    expect(tournamentRecord.factory?.defaultsHash).toBe((factory as any).defaultsHash);
  });

  it.runIf(stamps)('warns when sanctioning compared against other defaults than the tournament relies on', () => {
    const log = logger();
    const tournamentRecord: any = { tournamentId: 't-drift', factory: { defaultsHash: (factory as any).defaultsHash } };
    const attachedPoliciesDefaults = { defaultsHash: '0000000000000000', factoryVersion: '7.40.0' };
    attachSanctionedPolicies(
      tournamentRecord,
      { sanctioningId: 's', attachedPolicies: [], attachedPoliciesDefaults } as any,
      log,
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('0000000000000000'));

    const same = logger();
    const matching = { defaultsHash: (factory as any).defaultsHash, factoryVersion: factory.version() };
    attachSanctionedPolicies(
      tournamentRecord,
      { sanctioningId: 's', attachedPolicies: [], attachedPoliciesDefaults: matching } as any,
      same,
    );
    expect(same.warn).not.toHaveBeenCalled();
  });

  it('says nothing about defaults when AMS recorded none', () => {
    const log = logger();
    attachSanctionedPolicies({ tournamentId: 't-old-ams' }, { sanctioningId: 's', attachedPolicies: [] } as any, log);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('tournaments CFS creates carry the defaults stamp', () => {
  function approvedSanctioningRecord() {
    const engine = factory.sanctioningEngine as any;
    const policy = { ...(factory.fixtures as any).policies.POLICY_SANCTIONING_GENERIC, requireEndorsement: false };
    engine.reset();
    engine.executionQueue([
      {
        method: 'createSanctioningRecord',
        params: {
          governingBodyId: 'prov-1',
          applicant: { organisationId: 'org-1', organisationName: 'Club', contactName: 'A', contactEmail: 'a@b.c' },
          proposal: {
            tournamentName: 'Sanctioned Open',
            proposedStartDate: '2027-06-01',
            proposedEndDate: '2027-06-07',
            events: [{ eventName: 'Singles', eventType: 'SINGLES' }],
          },
        },
      },
      { method: 'submitApplication', params: { sanctioningPolicy: policy } },
      { method: 'reviewApplication', params: {} },
      { method: 'approveApplication', params: {} },
    ]);
    const { sanctioningRecord } = engine.getSanctioningRecord();
    engine.reset();
    return structuredClone(sanctioningRecord);
  }

  async function activate(attachedPolicies: any[]) {
    const saveTournamentRecord = vi.fn().mockResolvedValue({ success: true });
    await storeActivatedTournament({
      sanctioningRecord: { ...approvedSanctioningRecord(), attachedPolicies },
      tournamentStorageService: {
        findTournamentRecord: vi.fn().mockResolvedValue({ tournamentRecord: null }),
        saveTournamentRecord,
      } as any,
      sanctioningClient: { markActivated: vi.fn().mockResolvedValue(undefined) } as any,
      logger: logger(),
    });
    return saveTournamentRecord.mock.calls[0][0].tournamentRecord;
  }

  it.runIf(stamps)('an activated tournament that pins nothing still records the defaults it relies on', async () => {
    const tournamentRecord = await activate([]);
    expect(tournamentRecord.factory?.defaultsHash).toBe((factory as any).defaultsHash);
    expect(factory.policyGovernor.getAppliedPolicies({ tournamentRecord }).appliedPolicies).toEqual({});
  });

  it.runIf(stamps)(
    'an activated tournament that pins a policy keeps it with its provenance, and the stamp',
    async () => {
      const tournamentRecord = await activate([progression]);
      expect(tournamentRecord.factory?.defaultsHash).toBe((factory as any).defaultsHash);
      expect((tournamentRecord.appliedPolicies ?? {}).progression).toEqual(pinnedPolicyValue(progression));
      expect((factory.policyGovernor as any).getDefaultsDrift({ tournamentRecord }).defaultsDrift).toEqual([]);
    },
  );

  it.runIf(stamps)('a generated tournament carries the stamp', async () => {
    const { tournamentRecord } = await generateTournamentRecord(
      { drawProfiles: [{ drawSize: 4 }] },
      { roles: ['superadmin'] },
    );
    expect(tournamentRecord.factory?.defaultsHash).toBe((factory as any).defaultsHash);
  });

  it.skipIf(stamps)(
    'with a factory that predates the stamp, activation still stores the tournament and its policies',
    async () => {
      const tournamentRecord = await activate([progression]);
      expect(tournamentRecord.factory?.defaultsHash).toBeUndefined();
      expect(factory.policyGovernor.getAppliedPolicies({ tournamentRecord }).appliedPolicies?.progression).toEqual(
        pinnedPolicyValue(progression),
      );
    },
  );
});
