import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request for the authenticated, operational shared-facility schedule projection.
 * Returns slim `ScheduleCell[]` (unpublished — `usePublishState: false`), optionally filtered to
 * `venueIds`. Two modes:
 *  - `tournamentId` (coordination view): the context tournament the caller AUTHORS; the service
 *    returns projections of its server-verified linked peers, tagged `access:'author'|'view'`,
 *    with `view` peers opaque. This is how a director sees another tournament's court occupancy.
 *  - `tournamentIds` (legacy): slim cells for the requested tournaments the caller can view.
 * Both are optional on the DTO; the service validates that exactly one usable form is present.
 */
export class GetScheduleProjectionDto {
  @ApiPropertyOptional({ type: String })
  tournamentId?: string;

  @ApiPropertyOptional({ type: [String] })
  tournamentIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  venueIds?: string[];
}
