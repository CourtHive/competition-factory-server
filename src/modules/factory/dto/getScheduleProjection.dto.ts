import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request for the authenticated, operational shared-facility schedule projection.
 * Returns slim `ScheduleCell[]` (unpublished — `usePublishState: false`) for the requested
 * tournaments the caller is authorized to view, optionally filtered to `venueIds`.
 * `tournamentIds` is required at runtime (validated in the service) but declared optional to
 * match the repo DTO convention and strict property-initialization.
 */
export class GetScheduleProjectionDto {
  @ApiPropertyOptional({ type: [String] })
  tournamentIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  venueIds?: string[];
}
