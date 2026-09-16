import { ApiPropertyOptional } from '@nestjs/swagger';

import { DEFAULT_CALENDAR_PAGE_SIZE, MAX_CALENDAR_PAGE_SIZE } from '../helpers/calendarPaging';

export class GetMyCalendarsDto {
  @ApiPropertyOptional({
    description:
      'Scope to a single provider. REQUIRED for a SUPER_ADMIN — one with no providerAbbr has no membership to answer for and receives an empty list.',
  })
  providerAbbr?: string;

  @ApiPropertyOptional({
    description: `Page size. Clamped to [1, ${MAX_CALENDAR_PAGE_SIZE}].`,
    default: DEFAULT_CALENDAR_PAGE_SIZE,
    maximum: MAX_CALENDAR_PAGE_SIZE,
    minimum: 1,
  })
  limit?: number;

  @ApiPropertyOptional({ description: 'Window start across the concatenated calendars.', default: 0, minimum: 0 })
  offset?: number;
}
