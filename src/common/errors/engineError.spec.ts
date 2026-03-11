import { InternalServerErrorException } from '@nestjs/common';
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
});
