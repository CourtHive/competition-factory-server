import { InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';

// A factory error constant ({ code: 'ERR_…', message }) means the engine refused the request as sent: an
// invalid score, a missing drawDefinition, a date outside the tournament. That is the client's request,
// not a server fault, so it answers 400 (as the durable-command path already does). A persistence
// failure (`retryable`), a fenced save, an exception, or a bare-string error stays a 500.
function isEngineRefusal(result: any): boolean {
  if (result.retryable || result.fenced) return false;
  return typeof result.error === 'object' && typeof result.error?.code === 'string';
}

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
    const response = {
      message: errorMessage,
      ...(error.code && { code: error.code }),
      ...(context && { context }),
      ...(info && { info }),
      ...(stack && { stack }),
    };
    if (isEngineRefusal(result)) throw new BadRequestException(response);
    throw new InternalServerErrorException(response);
  }
}
