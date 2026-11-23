import { BadRequestException } from '@nestjs/common';

const keys = ['tournamentId', 'eventId', 'drawId', 'matchUpId'] as const;
export type MatchIds = Record<(typeof keys)[number], string>;
export function checkedObject(value: unknown, allowed: readonly string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new BadRequestException('Invalid operator request');
  return value as Record<string, unknown>;
}
export function validOperatorId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}
export function matchRequest(body: unknown): MatchIds {
  const object = checkedObject(body, keys);
  for (const key of keys) {
    const value = object[key];
    if (!validOperatorId(value)) throw new BadRequestException('Invalid match identifier');
  }
  return object as MatchIds;
}
