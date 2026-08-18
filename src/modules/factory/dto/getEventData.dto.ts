import { ApiProperty } from '@nestjs/swagger';

export class GetEventDataDto {
  @ApiProperty()
  hydrateParticipants: boolean = true;

  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  eventId: string = '';

  /**
   * The participant-set stamp this caller already holds, from a previous response.
   *
   * On an exact match the response omits `participants` — 52%-78.6% of the payload, and identical
   * across every event of a tournament. Optional: absent or stale means participants are included,
   * exactly as before, so the failure direction is "bytes that were not needed" rather than a draw
   * rendered with every side TBD.
   */
  @ApiProperty({ required: false })
  participantsVersion?: string;
}
