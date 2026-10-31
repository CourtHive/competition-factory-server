import { fixtures, mocksEngine, factoryConstants, readModel } from 'tods-competition-factory';

import { publicParticipantPrivacyPolicy } from '../functions/public/participantPrivacyPolicy';
import { SNAPSHOT_OWNED_TABLES, TABLE_PUBLIC_PARTICIPANTS } from './projectionConstants';
import {
  buildParticipantDocumentDeltas,
  documentPolicy,
  drainParticipantDocumentRequests,
} from './participantDocumentProducer';

/**
 * Public participant documents (W3): Projection-Producer serves each request from the stored record, under the policy
 * attached to it, and replaces the tournament's documents as one fenced span.
 */
const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;

function makeRecord() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    participantsProfile: { participantsCount: 6 },
    nonRandom: 1,
  });
  for (const participant of tournamentRecord.participants) {
    participant.person.birthDate = '2009-01-01';
    participant.person.sex = 'FEMALE';
  }
  return tournamentRecord;
}

function attach(record: any, policyDefinitions: any) {
  record.extensions = [...(record.extensions ?? []), { name: 'appliedPolicies', value: policyDefinitions }];
  return record;
}

function sexPolicy() {
  const policy = structuredClone(fixtures.policies.POLICY_PRIVACY_DEFAULT) as any;
  policy[POLICY_TYPE_PARTICIPANT].participant.person.sex = true;
  return policy;
}

function fakeOutbox(overrides: any = {}) {
  return {
    isEnabled: true,
    readForProjection: vi.fn(),
    pendingParticipantDocumentRequests: vi.fn().mockResolvedValue([]),
    completeParticipantDocuments: vi.fn().mockResolvedValue('enqueued'),
    recordParticipantDocumentFailure: vi.fn(),
    ...overrides,
  } as any;
}

describe('documentPolicy', () => {
  it('uses the policy attached to the record', () => {
    const record = attach(makeRecord(), sexPolicy());
    expect(documentPolicy(record)[POLICY_TYPE_PARTICIPANT].participant.person.sex).toBe(true);
  });

  it('falls back to the strict public default, never an unfiltered document, when none is attached', () => {
    expect(documentPolicy(makeRecord())).toEqual(publicParticipantPrivacyPolicy());
  });
});

describe('buildParticipantDocumentDeltas', () => {
  it('is one span that purges only the documents table, then one upsert per competitor', () => {
    const record = makeRecord();
    const deltas = buildParticipantDocumentDeltas({ tournamentRecord: record, snapshotId: 's-1', source: 'mutation' });

    const [begin, ...rest] = deltas;
    const end = rest.pop() as any;
    expect(begin).toMatchObject({
      op: 'snapshot_begin',
      key: { snapshotId: 's-1' },
      row: { tables: [TABLE_PUBLIC_PARTICIPANTS] },
    });
    expect(end).toMatchObject({ op: 'snapshot_end', key: { snapshotId: 's-1' }, row: { deltaCount: rest.length } });
    expect(rest).toHaveLength(record.participants.length);
    for (const delta of rest) {
      expect(delta).toMatchObject({ op: 'upsert', table: TABLE_PUBLIC_PARTICIPANTS, snapshotId: 's-1' });
      expect(Object.keys(delta.row ?? {}).sort()).toEqual([...readModel.READ_MODEL_COLUMNS.public_participants].sort());
      expect(delta.key).toEqual({ tournament_id: record.tournamentId, participant_id: delta.row?.participant_id });
    }
  });

  it('redacts under the attached policy: the default withholds birth date and sex', () => {
    const strict = buildParticipantDocumentDeltas({ tournamentRecord: makeRecord(), snapshotId: 's', source: 'm' });
    const documents = strict.filter((delta) => delta.op === 'upsert').map((delta) => delta.row?.document);
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document.person.birthDate).toBeUndefined();
      expect(document.person.sex).toBeUndefined();
      expect(document.person.standardFamilyName).toBeDefined();
    }

    // the control: a policy attached to the record that allows sex lets it through, and only that
    const widened = buildParticipantDocumentDeltas({
      tournamentRecord: attach(makeRecord(), sexPolicy()),
      snapshotId: 's',
      source: 'm',
    });
    for (const delta of widened.filter((delta) => delta.op === 'upsert')) {
      expect(delta.row?.document.person.sex).toEqual('FEMALE');
      expect(delta.row?.document.person.birthDate).toBeUndefined();
    }
  });

  it('names the policy that produced each document', () => {
    const record = attach(makeRecord(), sexPolicy());
    const deltas = buildParticipantDocumentDeltas({ tournamentRecord: record, snapshotId: 's', source: 'm' });
    const hash = readModel.participantPolicyHash(sexPolicy());
    for (const delta of deltas.filter((delta) => delta.op === 'upsert')) expect(delta.row?.policy_hash).toEqual(hash);
  });

  it('is never purged by a record snapshot', () => {
    expect(SNAPSHOT_OWNED_TABLES).not.toContain(TABLE_PUBLIC_PARTICIPANTS);
  });
});

describe('drainParticipantDocumentRequests', () => {
  const request = (tournamentId: string, attempts = 0) => ({
    tournamentId,
    requestedAt: 'r1',
    source: 'mutation',
    attempts,
  });

  it('serves a request from the stored record through the fence', async () => {
    const record = makeRecord();
    const outbox = fakeOutbox({
      pendingParticipantDocumentRequests: vi.fn().mockResolvedValue([request(record.tournamentId)]),
      readForProjection: vi.fn().mockResolvedValue({ tournamentRecord: record, updatedAt: 'u1' }),
    });

    const result = await drainParticipantDocumentRequests(outbox);

    expect(result).toEqual({ examined: 1, enqueued: 1, changed: 0, missing: 0, failed: 0 });
    const call = outbox.completeParticipantDocuments.mock.calls[0][0];
    expect(call).toMatchObject({ tournamentId: record.tournamentId, requestedAt: 'r1', updatedAt: 'u1' });
    expect(call.deltas[0].op).toEqual('snapshot_begin');
  });

  it('completes a request for a tournament that no longer exists with an empty span', async () => {
    const outbox = fakeOutbox({
      pendingParticipantDocumentRequests: vi.fn().mockResolvedValue([request('gone')]),
      readForProjection: vi.fn().mockResolvedValue(undefined),
      completeParticipantDocuments: vi.fn().mockResolvedValue('missing'),
    });
    expect((await drainParticipantDocumentRequests(outbox)).missing).toBe(1);
    expect(outbox.completeParticipantDocuments).toHaveBeenCalledWith({
      tournamentId: 'gone',
      requestedAt: 'r1',
      updatedAt: '',
      deltas: [],
    });
  });

  it('keeps a failed build as a request and counts it', async () => {
    const outbox = fakeOutbox({
      pendingParticipantDocumentRequests: vi.fn().mockResolvedValue([request('t-1')]),
      readForProjection: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const result = await drainParticipantDocumentRequests(outbox);
    expect(result.failed).toBe(1);
    expect(outbox.recordParticipantDocumentFailure).toHaveBeenCalledWith('t-1', 'db down');
  });

  it('skips a request that has used its attempts', async () => {
    const outbox = fakeOutbox({
      pendingParticipantDocumentRequests: vi.fn().mockResolvedValue([request('t-1', 5)]),
    });
    expect((await drainParticipantDocumentRequests(outbox)).examined).toBe(0);
    expect(outbox.readForProjection).not.toHaveBeenCalled();
  });
});
