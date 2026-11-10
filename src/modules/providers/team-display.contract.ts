import { normalizeTeamPalette, type TeamColors } from 'tods-competition-factory';
import { BadRequestException } from '@nestjs/common';

/** Shared by the focused editor endpoint and generic provider add/modify writes. */
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
