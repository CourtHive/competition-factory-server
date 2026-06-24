import { InternalServerErrorException, Logger } from '@nestjs/common';

export function checkEngineError(result: any) {
  if (!result.success) {
    const { error, context, info, stack } = result;
    if (!error) throw new InternalServerErrorException('Unknown engine error');
    const stackTail = Array.isArray(stack) && stack.length ? stack.slice(-1)[0] : undefined;
    const methodName = error.methodName || stackTail || 'error';
    const errorMessage = `${methodName}: ${error.message}`;
    const contextString = context ? ` | context: ${JSON.stringify(context)}` : '';
    // `info` carries the human-readable disambiguator the factory attaches to
    // otherwise-identical error codes — e.g. an out-of-range INVALID_DATE adds
    // "scheduledDate must be within tournament start and end dates", which a
    // malformed-date INVALID_DATE does not. Omitting it made a valid-looking
    // date log as a phantom format error.
    const infoString = info ? ` | info: ${typeof info === 'string' ? info : JSON.stringify(info)}` : '';
    Logger.error(`${errorMessage}${contextString}${infoString}`);
    throw new InternalServerErrorException({
      message: errorMessage,
      ...(error.code && { code: error.code }),
      ...(context && { context }),
      ...(info && { info }),
      ...(stack && { stack }),
    });
  }
}
