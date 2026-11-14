import { InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';

// A factory error constant ({ code: 'ERR_…', message }) means the engine refused the request as sent: an
// invalid score, a missing drawDefinition, a date outside the tournament. That is the client's request,
// not a server fault, so it answers 400 (as the durable-command path already does). A persistence
// failure (`retryable`), a fenced save, an exception, or a bare-string error stays a 500.
function isEngineRefusal(result: any): boolean {
  if (result.retryable || result.fenced) return false;
  return typeof result.error === 'object' && typeof result.error?.code === 'string';
}

const LISTED = 5;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function listed(values: unknown[]): string {
  const names = values.filter((value) => typeof value === 'string' && value);
  const shown = names.slice(0, LISTED).join(',');
  return names.length > LISTED ? `${shown},+${names.length - LISTED} more` : shown;
}

/**
 * What a rejection log line needs to name the request it refused: the tournaments, the methods and who sent it.
 * Without it, a refusal from an integration ("error: Missing tournamentRecord", IONSport 2026-11-14) named
 * neither the tournament nor the key, so nobody could say which tournament was meant.
 *
 * Every value is ONE string, never an array or a number: courthive-notify fingerprints the line to group repeats
 * into one alert, and it collapses quoted strings to `<str>`. Kept as strings, with every key always present (empty
 * when the request lacks it), the summary never splits a group. Only the log line carries it; the HTTP response
 * does not.
 */
export function rejectedRequestSummary(params: any): Record<string, string> {
  const tournamentIds = params?.tournamentIds ?? (params?.tournamentId ? [params.tournamentId] : []);
  const methods = [...new Set((params?.methods ?? []).map((directive: any) => directive?.method))];
  const actor = params?.userEmail ?? params?.userId;
  return {
    tournamentIds: listed(Array.isArray(tournamentIds) ? tournamentIds : []),
    methods: listed(methods),
    actor: text(actor),
    source: text(params?.auditSource?.type),
    // the provisioner key's id, never the key: it is what the provisioner's key list shows
    keyId: text(params?.auditSource?.keyId),
  };
}

export function checkEngineError(result: any, request?: Record<string, string>) {
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
    const requestString = request ? ` | request: ${JSON.stringify(request)}` : '';
    // No Nest context argument: courthive-notify routes a context-less `methodName: …` line to engine-rejections.
    Logger.error(`${errorMessage}${contextString}${infoString}${requestString}`);
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
