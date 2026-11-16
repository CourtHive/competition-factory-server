import { InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { checkEngineError, rejectedRequestSummary } from './engineError';

describe('checkEngineError', () => {
  it('does not throw when result.success is true', () => {
    expect(() => checkEngineError({ success: true })).not.toThrow();
  });

  it('throws InternalServerErrorException when success is false and no error', () => {
    expect(() => checkEngineError({ success: false })).toThrow(InternalServerErrorException);
    expect(() => checkEngineError({ success: false })).toThrow('Unknown engine error');
  });

  it('throws with methodName and message from error object', () => {
    const result = {
      success: false,
      error: { methodName: 'addEvent', message: 'Missing event' },
    };
    expect(() => checkEngineError(result)).toThrow(InternalServerErrorException);
    expect(() => checkEngineError(result)).toThrow('addEvent: Missing event');
  });

  it('uses "error" prefix when methodName is missing', () => {
    const result = {
      success: false,
      error: { message: 'Something went wrong' },
    };
    expect(() => checkEngineError(result)).toThrow('error: Something went wrong');
  });

  it('does not throw for truthy success values', () => {
    expect(() => checkEngineError({ success: 1 })).not.toThrow();
    expect(() => checkEngineError({ success: 'yes' })).not.toThrow();
  });

  it('includes context, code, and stack in the thrown response', () => {
    const result = {
      success: false,
      error: { message: 'Invalid participantIds', code: 'ERR_INVALID_PARTICIPANT_IDS' },
      context: { mismatchedGender: [{ participantId: 'p1', sex: 'FEMALE' }], gender: 'MALE' },
      stack: ['addEventEntries'],
    };
    try {
      checkEngineError(result);
      throw new Error('expected checkEngineError to throw');
    } catch (err: any) {
      const response = err.getResponse();
      expect(response.message).toBe('addEventEntries: Invalid participantIds');
      expect(response.code).toBe('ERR_INVALID_PARTICIPANT_IDS');
      expect(response.context).toEqual(result.context);
      expect(response.stack).toEqual(['addEventEntries']);
    }
  });

  it('logs the info disambiguator so out-of-range and malformed dates differ in the log', () => {
    const spy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const result = {
      success: false,
      error: { message: 'Invalid Date', code: 'ERR_INVALID_DATE' },
      context: { scheduledDate: '2026-03-21' },
      info: 'scheduledDate must be within tournament start and end dates',
      stack: ['addMatchUpScheduleItems'],
    };
    expect(() => checkEngineError(result)).toThrow(BadRequestException);
    expect(spy).toHaveBeenCalledWith(
      'addMatchUpScheduleItems: Invalid Date | context: {"scheduledDate":"2026-03-21"} | info: scheduledDate must be within tournament start and end dates',
    );
    spy.mockRestore();
  });

  it('omits the info segment when the error result carries no info', () => {
    const spy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const result = {
      success: false,
      error: { message: 'Invalid Date', code: 'ERR_INVALID_DATE' },
      context: { scheduledDate: 'banana' },
      stack: ['addMatchUpScheduleItems'],
    };
    expect(() => checkEngineError(result)).toThrow(BadRequestException);
    expect(spy).toHaveBeenCalledWith('addMatchUpScheduleItems: Invalid Date | context: {"scheduledDate":"banana"}');
    spy.mockRestore();
  });

  it('falls back to "error" prefix when no methodName or stack is provided', () => {
    const result = {
      success: false,
      error: { message: 'Invalid participantIds' },
      context: { gender: 'MALE' },
    };
    try {
      checkEngineError(result);
      throw new Error('expected checkEngineError to throw');
    } catch (err: any) {
      const response = err.getResponse();
      expect(response.message).toBe('error: Invalid participantIds');
      expect(response.context).toEqual({ gender: 'MALE' });
    }
  });

  describe("status: a refusal is the client's, a failure is the server's", () => {
    const status = (result: any) => {
      try {
        checkEngineError(result);
      } catch (err: any) {
        return err.getStatus();
      }
      return undefined;
    };

    it('answers 400 for a factory error constant, as the production INVALID_SCORE was', () => {
      const result = {
        success: false,
        error: { message: 'Invalid score', code: 'ERR_INVALID_SCORE' },
        stack: ['setMatchUpStatus'],
      };
      expect(status(result)).toBe(400);
      try {
        checkEngineError(result);
      } catch (err: any) {
        expect(err.getResponse()).toMatchObject({
          message: 'setMatchUpStatus: Invalid score',
          code: 'ERR_INVALID_SCORE',
        });
      }
    });

    it('stays 500 for a persistence failure, even one that carries a code', () => {
      expect(status({ error: 'Could not persist tournament record(s)', retryable: true })).toBe(500);
      expect(status({ error: { message: 'x', code: 'ERR_X' }, retryable: true })).toBe(500);
    });

    it('stays 500 for a fenced save', () => {
      expect(status({ error: 'Fenced: tournament is owned by a newer epoch', fenced: true })).toBe(500);
      expect(status({ error: { message: 'x', code: 'ERR_X' }, fenced: true })).toBe(500);
    });

    it('stays 500 for a bare-string error (exceptions caught by executionQueue)', () => {
      expect(status({ error: 'connection terminated unexpectedly' })).toBe(500);
    });

    it('stays 500 for an error object with no code', () => {
      expect(status({ error: { message: 'Missing event' } })).toBe(500);
    });
  });

  describe('the rejection log names the request it refused', () => {
    // The shape POST /factory hands the service after stampVerifiedIdentity: an integration's provisioner key.
    const provisionerRequest = {
      tournamentIds: ['3174d563-0000-4000-8000-000000000000'],
      methods: [{ method: 'addEvent' }, { method: 'addEvent' }, { method: 'addDrawDefinition' }],
      userEmail: 'provisioner@IONSport',
      userId: null,
      auditSource: { type: 'provisioner', provisionerId: 'prov-1', keyId: 'key-1', keyLabel: 'Production' },
    };

    it('summarises tournaments, distinct methods, actor, source and key id', () => {
      expect(rejectedRequestSummary(provisionerRequest)).toEqual({
        tournamentIds: '3174d563-0000-4000-8000-000000000000',
        methods: 'addEvent,addDrawDefinition',
        actor: 'provisioner@IONSport',
        source: 'provisioner',
        keyId: 'key-1',
      });
    });

    it('lists five and counts the rest, so a bulk request cannot flood the line', () => {
      const tournamentIds = Array.from({ length: 8 }, (_, i) => `t${i}`);
      expect(rejectedRequestSummary({ tournamentIds }).tournamentIds).toBe('t0,t1,t2,t3,t4,+3 more');
    });

    it('takes a single tournamentId when no list is given, and leaves what the request does not carry empty', () => {
      expect(rejectedRequestSummary({ tournamentId: 't1', userId: 'u1' })).toEqual({
        tournamentIds: 't1',
        methods: '',
        actor: 'u1',
        source: '',
        keyId: '',
      });
      expect(rejectedRequestSummary(undefined)).toEqual({
        tournamentIds: '',
        methods: '',
        actor: '',
        source: '',
        keyId: '',
      });
    });

    // courthive-notify fingerprints the line to group repeats and collapses quoted strings to <str>: an array or a
    // number would make every distinct request its own alert.
    it('carries the same keys, each a single string, whatever the request held', () => {
      const keys = ['tournamentIds', 'methods', 'actor', 'source', 'keyId'];
      for (const request of [provisionerRequest, { tournamentIds: ['a', 'b', 'c'], userId: 7 }, {}]) {
        const summary = rejectedRequestSummary(request);
        expect(Object.keys(summary)).toEqual(keys);
        for (const value of Object.values(summary)) expect(typeof value).toBe('string');
      }
    });

    it("logs it after the message, keeping the line's methodName prefix and no Nest context", () => {
      const spy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
      const result = { success: false, error: { message: 'Missing tournamentRecord', code: 'ERR_MISSING_TOURNAMENT' } };
      let response: any;
      try {
        checkEngineError(result, rejectedRequestSummary(provisionerRequest));
      } catch (err: any) {
        response = err.getResponse();
      }
      expect(spy).toHaveBeenCalledTimes(1);
      const call = spy.mock.calls[0];
      expect(call).toHaveLength(1);
      expect(call[0]).toBe(
        'error: Missing tournamentRecord | request: {"tournamentIds":"3174d563-0000-4000-8000-000000000000",' +
          '"methods":"addEvent,addDrawDefinition","actor":"provisioner@IONSport","source":"provisioner","keyId":"key-1"}',
      );
      // the summary is for the operator's log, not the caller's response
      expect(response).toEqual({ message: 'error: Missing tournamentRecord', code: 'ERR_MISSING_TOURNAMENT' });
      spy.mockRestore();
    });
  });
});
