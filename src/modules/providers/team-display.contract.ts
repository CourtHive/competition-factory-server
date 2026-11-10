import { normalizeTeamPalette, type TeamColors } from 'tods-competition-factory';
import { BadRequestException } from '@nestjs/common';

/** Validation plan for `PUT /provider/:providerId/team-display`, the only write path for provider teamColors. */
export function providerTeamColorPlan(value: unknown): { clear: boolean; colors?: TeamColors } {
  const clear =
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.toString.call(value) === '[object Object]' &&
    !Object.keys(value).length;
  const colors = clear ? undefined : normalizeTeamPalette(value);
  if (!clear && !colors) throw new BadRequestException('Invalid CODES team colors or display roles');
  return { clear, colors };
}

/**
 * Generic `POST /provider/add` and `/provider/modify` are not scoped to the provider's own administrator
 * (legacy ADMIN may modify any provider), so they must never carry teamColors. A payload that names the
 * field — any value, including null or `{}` — is refused rather than stripped, so the caller learns the
 * write did not happen.
 */
export function refuseGenericTeamColorsWrite(payload: unknown): void {
  if (payload !== null && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'teamColors'))
    throw new BadRequestException('teamColors can only be written via PUT /provider/:providerId/team-display');
}
