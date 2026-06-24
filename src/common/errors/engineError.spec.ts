import { InternalServerErrorException, Logger } from '@nestjs/common';
import { checkEngineError } from './engineError';

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
    const spy = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const result = {
      success: false,
      error: { message: 'Invalid Date', code: 'ERR_INVALID_DATE' },
      context: { scheduledDate: '2026-03-21' },
      info: 'scheduledDate must be within tournament start and end dates',
      stack: ['addMatchUpScheduleItems'],
    };
    expect(() => checkEngineError(result)).toThrow(InternalServerErrorException);
    expect(spy).toHaveBeenCalledWith(
      'addMatchUpScheduleItems: Invalid Date | context: {"scheduledDate":"2026-03-21"} | info: scheduledDate must be within tournament start and end dates',
    );
    spy.mockRestore();
  });

  it('omits the info segment when the error result carries no info', () => {
    const spy = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const result = {
      success: false,
      error: { message: 'Invalid Date', code: 'ERR_INVALID_DATE' },
      context: { scheduledDate: 'banana' },
      stack: ['addMatchUpScheduleItems'],
    };
    expect(() => checkEngineError(result)).toThrow(InternalServerErrorException);
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
});
