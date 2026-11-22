import { BadRequestException } from '@nestjs/common';

export const SAFE_CODES = [
  'ERR_INVALID_CATEGORY',
  'ERR_INVALID_GENDER',
  'ERR_INVALID_PARTICIPANT',
  'ERR_INVALID_PARTICIPANT_IDS',
  'ERR_INVALID_ENTRIES',
  'ERR_MISSING_TOURNAMENT',
  'ERR_MISSING_EVENT_ID',
  'ERR_NOT_FOUND_PARTICIPANT',
  'UNCLASSIFIED',
  'INVALID_PARTICIPANTS',
  'NOT_AUTHORIZED',
  'NOT_LOGGED_IN',
  'STALE_DATA',
  'OFFLINE',
  'HTTP_CLIENT_ERROR',
  'HTTP_SERVER_ERROR',
  'NETWORK_ERROR',
  'MUTATION_REFUSED',
];
export const SAFE_ROUTES = [
  'tournaments',
  'tournament',
  'events',
  'participants',
  'schedule',
  'venues',
  'settings',
  'other',
];
export const SAFE_METHODS = [
  'unknown',
  'addEvent',
  'addDrawDefinition',
  'addEventEntries',
  'addParticipants',
  'setMatchUpStatus',
  'setMatchUpSchedule',
  'modifyEvent',
  'removeEvent',
  'removeDrawDefinition',
];
export const SAFE_FINDINGS = [
  'UNSPECIFIED',
  'PARTICIPANT_ROLE_MISSING',
  'PARTICIPANT_ROLE_INVALID',
  'PARTICIPANT_IDENTITY_DUPLICATION',
  'MATCHUP_FORMAT_MALFORMED',
  'MATCHUP_FORMAT_REFUSED_FOR_NEW_USE',
];
export const SUPPORT_KINDS = ['bug', 'suggestion'];
export type SupportKind = 'bug' | 'suggestion';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k)))
    throw new BadRequestException('Unsupported support evidence');
  return value as Record<string, any>;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000)
    throw new BadRequestException('Invalid evidence count');
  return Number(value);
}
function member(value: unknown, values: string[]) {
  if (typeof value !== 'string' || !values.includes(value)) throw new BadRequestException('Unknown evidence code');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException('Invalid evidence flag');
  return value;
}
export function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max || value.includes('\u0000'))
    throw new BadRequestException('Invalid support text');
  return value.trim();
}
export function parseReport(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > 150_000) throw new BadRequestException('Report too large');
  const body = object(value, [
    'submissionKey',
    'tournamentId',
    'description',
    'evidence',
    'expectedReporter',
    'expectedProvider',
    'kind',
  ]);
  // expectedProvider is absent for platform feedback (no provider selected). When present it is a comparison fence,
  // or, for a super-admin, the provider being impersonated: never an ownership claim.
  if (
    typeof body.expectedReporter !== 'string' ||
    !body.expectedReporter.length ||
    body.expectedReporter.length > 254 ||
    (body.expectedProvider !== undefined &&
      (typeof body.expectedProvider !== 'string' ||
        !body.expectedProvider.length ||
        body.expectedProvider.length > 200))
  )
    throw new BadRequestException('Expected reporting session required');
  const kind = body.kind ?? 'bug';
  if (!SUPPORT_KINDS.includes(kind)) throw new BadRequestException('Unknown feedback kind');
  if (typeof body.submissionKey !== 'string' || !UUID.test(body.submissionKey))
    throw new BadRequestException('Invalid submission key');
  if (
    body.tournamentId !== undefined &&
    (typeof body.tournamentId !== 'string' || !body.tournamentId.length || body.tournamentId.length > 200)
  )
    throw new BadRequestException('Invalid source tournament');
  // A suggestion carries no error diagnostics or validation findings: its form does not collect them.
  const evidence = object(
    body.evidence,
    kind === 'suggestion'
      ? ['route', 'online', 'version']
      : ['route', 'online', 'version', 'diagnostics', 'validation'],
  );
  const route = member(evidence.route, SAFE_ROUTES);
  const online = boolean(evidence.online);
  if (
    typeof evidence.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(evidence.version) ||
    evidence.version.length > 60
  )
    throw new BadRequestException('Invalid app version');
  const common = {
    kind: kind as SupportKind,
    submissionKey: body.submissionKey as string,
    expectedReporter: body.expectedReporter as string,
    expectedProvider: body.expectedProvider as string | undefined,
    tournamentId: body.tournamentId as string | undefined,
    description: boundedText(body.description, 8192),
  };
  if (kind === 'suggestion') return { ...common, evidence: { route, online, version: evidence.version as string } };
  if (
    !Array.isArray(evidence.diagnostics) ||
    evidence.diagnostics.length > 50 ||
    Buffer.byteLength(JSON.stringify(evidence.diagnostics)) > 65_536
  )
    throw new BadRequestException('Diagnostics too large');
  const diagnostics = evidence.diagnostics.map((item: unknown) => {
    const d = object(item, ['time', 'code', 'method', 'route']);
    if (
      typeof d.time !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(d.time) ||
      !Number.isFinite(Date.parse(d.time))
    )
      throw new BadRequestException('Invalid diagnostic time');
    return {
      time: d.time,
      code: member(d.code, SAFE_CODES),
      method: member(d.method, SAFE_METHODS),
      route: member(d.route, SAFE_ROUTES),
    };
  });
  const v = object(evidence.validation, [
    'count',
    'schemaErrorCount',
    'inconsistencyCount',
    'schemaUnavailable',
    'integrityUnavailable',
    'truncated',
    'codes',
    'factoryVersion',
  ]);
  if (!Array.isArray(v.codes) || v.codes.length > 100 || Buffer.byteLength(JSON.stringify(v)) > 65_536)
    throw new BadRequestException('Validation summary too large');
  const factoryVersion = v.factoryVersion ?? 'unknown';
  if (
    factoryVersion !== 'unknown' &&
    (typeof factoryVersion !== 'string' ||
      factoryVersion.length > 60 ||
      !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(factoryVersion))
  )
    throw new BadRequestException('Invalid validator version');
  const validation = {
    factoryVersion,
    count: integer(v.count),
    schemaErrorCount: integer(v.schemaErrorCount),
    inconsistencyCount: integer(v.inconsistencyCount),
    schemaUnavailable: boolean(v.schemaUnavailable),
    integrityUnavailable: boolean(v.integrityUnavailable),
    truncated: boolean(v.truncated),
    codes: v.codes.map((code: unknown) => member(code, SAFE_FINDINGS)),
  };
  return { ...common, evidence: { route, online, version: evidence.version as string, diagnostics, validation } };
}
export type SupportReport = ReturnType<typeof parseReport>;
