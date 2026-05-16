import { InternalServerErrorException, Logger } from '@nestjs/common';

export function checkEngineError(result: any) {
  if (!result.success) {
    const { error, context, info, stack } = result;
    if (!error) throw new InternalServerErrorException('Unknown engine error');
    const stackTail = Array.isArray(stack) && stack.length ? stack.slice(-1)[0] : undefined;
    const methodName = error.methodName || stackTail || 'error';
    const errorMessage = `${methodName}: ${error.message}`;
    const contextString = context ? ` | context: ${JSON.stringify(context)}` : '';
    Logger.error(`${errorMessage}${contextString}`);
    throw new InternalServerErrorException({
      message: errorMessage,
      ...(error.code && { code: error.code }),
      ...(context && { context }),
      ...(info && { info }),
      ...(stack && { stack }),
    });
  }
}
