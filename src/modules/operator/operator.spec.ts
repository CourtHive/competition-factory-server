import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { OperatorMatchEnabled } from './operator.controller';
import { OperatorMatchService } from './operator-match.service';
import { scoreRequest, operatorScorePrecondition } from './scoreRequest';
import { matchRequest } from './matchRequest';
import { markRecordRevision, recordRevision } from 'src/storage/postgres/recordRevision';
import type { UserContext } from '../account/auth/decorators/user-context.decorator';

const ids = { tournamentId: 't', drawId: 'd', eventId: 'e', matchUpId: 'm' };
const user: UserContext = {
  userId: 'u',
  email: 'recorder@example.test',
  isSuperAdmin: false,
  globalRoles: [],
  providerIds: ['p'],
  providerRoles: { p: 'DIRECTOR' },
  actingProviderId: 'p',
};
const grant = { userId: 'u', tournamentId: 't', providerId: 'p', capability: 'canEnterScores', scope: {} };
const record = {
  tournamentId: 't',
  parentOrganisation: { organisationId: 'p' },
  events: [{ eventId: 'e', drawDefinitions: [{ drawId: 'd' }] }],
};
const outcome = {
  matchUpStatus: 'COMPLETED',
  winningSide: 1,
  score: { sets: [{ setNumber: 1, side1Score: 6, side2Score: 2, winningSide: 1 }] },
};
const rev = 'a'.repeat(43);
function fixture() {
  const grants = vi.fn().mockResolvedValue([grant]);
  const scoringCatalogue = vi.fn();
  const gate = vi.fn().mockResolvedValue(null);
  const queue = vi.fn(async (payload) => {
    await payload[operatorScorePrecondition]({ t: record });
    return { success: true, durableReceipt: true };
  });
  const service = new OperatorMatchService(
    { commit: queue } as never,
    { fetchTournamentRecords: async () => ({ tournamentRecords: { t: record } }) } as never,
    { gate, scoringCatalogue } as never,
    { findForSubject: grants } as never,
  );
  const match = { resultIntent: 'record-initial-result', disabledMatchUpStatuses: [] as string[], clearable: false };
  // Only the factory/storage boundary is substituted. Production grants, request parsing,
  // receipt identity and the precondition passed to the durable queue are exercised.
  const dto = vi
    .spyOn(service as any, 'matchDto')
    .mockImplementation((...args) => ({ match, revision: rev, audience: args[2] }));
  const command = (extras: Record<string, unknown> = {}) =>
    scoreRequest({ target: ids, intent: 'record-initial-result', commandId: 'test-score-01', outcome, ...extras });
  return { service, grants, gate, scoringCatalogue, dto, match, queue, command };
}
describe('operator boundary', () => {
  it('requires explicit operator enablement', () => {
    try {
      vi.stubEnv('OPERATOR_MATCH_ENABLED', 'off');
      expect(() => new OperatorMatchEnabled().canActivate()).toThrow();
      vi.stubEnv('OPERATOR_MATCH_ENABLED', 'true');
      expect(new OperatorMatchEnabled().canActivate()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('rejects untrusted context and identifiers', () => {
    for (const field of ['record', 'drawDefinition', 'policyDefinitions', 'inContextDrawMatchUps', 'operatorAudience'])
      expect(() => matchRequest({ ...ids, [field]: {} })).toThrow(BadRequestException);
    expect(() => matchRequest({ ...ids, matchUpId: '' })).toThrow(BadRequestException);
  });
  it('requires a correction revision and a well-formed outcome', () => {
    const { command } = fixture();
    expect(() => command({ intent: 'correct-result' })).toThrow(BadRequestException);
    expect(() => command({ outcome: { ...outcome, winningSide: 9 } })).toThrow(BadRequestException);
  });
  it('accepts status reasons keyed as the engine stores them, and refuses the positional array', () => {
    const { command } = fixture();
    const defaulted = { ...outcome, matchUpStatus: 'DEFAULTED', sideStatusCodes: { 2: 'DM' } };
    expect(command({ outcome: defaulted }).outcome.sideStatusCodes).toEqual({ 2: 'DM' });
    const abandoned = { score: { sets: [] }, matchUpStatus: 'ABANDONED', matchUpStatusCode: 'OA' };
    expect(command({ outcome: abandoned }).outcome.matchUpStatusCode).toBe('OA');
    expect(command({ outcome: { score: { sets: [] }, clearStatusCodes: true } }).emptyScore).toBe(true);

    expect(() => command({ outcome: { ...outcome, matchUpStatusCodes: ['', 'DM'] } })).toThrow(BadRequestException);
    for (const sideStatusCodes of [['DM'], { 3: 'DM' }, { 1: 7 }, { 1: 'x'.repeat(33) }, 'DM', null])
      expect(() => command({ outcome: { ...outcome, sideStatusCodes } })).toThrow(BadRequestException);
    for (const matchUpStatusCode of [7, 'x'.repeat(33), ['OA']])
      expect(() => command({ outcome: { ...outcome, matchUpStatusCode } })).toThrow(BadRequestException);
    expect(() => command({ outcome: { ...outcome, clearStatusCodes: 'yes' } })).toThrow(BadRequestException);
  });
  it('passes only the verified member and candidate IDs to catalogue authorization', async () => {
    const { service, scoringCatalogue, dto } = fixture();
    scoringCatalogue.mockResolvedValue(['t']);
    expect(await service.catalogueAccess(['t', 'other'], user)).toEqual({ tournamentIds: ['t'] });
    expect(scoringCatalogue).toHaveBeenCalledExactlyOnceWith('p', user, ['t', 'other']);
    expect(dto).not.toHaveBeenCalled();
    await expect(service.catalogueAccess(['t'], { ...user, providerIds: [] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(scoringCatalogue).toHaveBeenCalledTimes(1);
  });
  it('denies a revoked grant before the factory runs', async () => {
    const { service, grants, dto } = fixture();
    grants.mockResolvedValue([]);
    await expect(service.read(ids, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dto).not.toHaveBeenCalled();
  });
  it('denies expired and out-of-scope grants', async () => {
    const { service, grants, dto } = fixture();
    for (const row of [
      { ...grant, notAfter: '2000-01-01T00:00:00Z' },
      { ...grant, scope: { drawIds: ['other'] } },
    ]) {
      grants.mockResolvedValue([row]);
      await expect(service.read(ids, user)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(dto).not.toHaveBeenCalled();
  });
  it('refuses switched provider, service keys and revoked membership', async () => {
    const { service, dto } = fixture();
    for (const change of [{ actingProviderId: 'other' }, { apiKey: 'provider' as const }, { providerIds: [] }]) {
      await expect(service.read(ids, { ...user, ...change })).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(dto).not.toHaveBeenCalled();
  });
  it('refuses an independent mutation authorization denial', async () => {
    const { service, gate, dto } = fixture();
    gate.mockResolvedValue('denied');
    await expect(service.read(ids, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dto).not.toHaveBeenCalled();
  });
  it('derives recorder audience from verified context', async () => {
    const { service, dto } = fixture();
    await service.read(ids, user);
    expect(dto).toHaveBeenCalledExactlyOnceWith(ids, record, 'recorder');
  });
  it('refuses stale reviewed revision inside the queue', async () => {
    const { service, command, match, queue } = fixture();
    match.resultIntent = 'correct-result';
    await expect(
      service.score(command({ intent: 'correct-result', revision: 'b'.repeat(43) }), user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(queue).toHaveBeenCalledTimes(1);
  });
  it('refuses a second initial result inside the queue', async () => {
    const { service, command, match } = fixture();
    match.resultIntent = 'correct-result';
    await expect(service.score(command(), user)).rejects.toBeInstanceOf(ConflictException);
  });
  it('refuses a disabled status and a disallowed clear', async () => {
    const { service, command, match } = fixture();
    match.disabledMatchUpStatuses = ['COMPLETED'];
    await expect(service.score(command(), user)).rejects.toBeInstanceOf(ConflictException);
    match.resultIntent = 'correct-result';
    await expect(
      service.score(command({ intent: 'correct-result', revision: rev, outcome: { score: { sets: [] } } }), user),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('distinguishes successive commits with the same timestamp', () => {
    const first = {},
      second = {};
    markRecordRevision(first, 't', '13/1234.0');
    markRecordRevision(second, 't', '14/1234.0');
    expect(recordRevision(first)).toHaveLength(43);
    expect(recordRevision(first)).not.toBe(recordRevision(second));
  });
});
