import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  /**
   * How much of each draw to return — `'FULL'` (default) or `'STUBS'`.
   *
   * `STUBS` replaces every draw's structures/roundMatchUps with a stub carrying `drawId`, `drawName`,
   * `drawType`, `display`, `drawGenerated`, `drawCompleted` and `drawPublished` — the draw list a
   * client needs to render navigation, without the brackets behind it.
   *
   * Enablement only as of 2026-08-28: factory has supported this since the G2 payload-decomposition
   * work but it was unreachable over HTTP, because this DTO had no field for it and the service
   * dropped it. No consumer sends it yet.
   *
   * An unknown value is rejected by the factory rather than falling through to FULL — a typo must not
   * quietly return the payload the caller was explicitly trying to avoid.
   */
  @ApiPropertyOptional({ enum: ['FULL', 'STUBS'] })
  drawsProfile?: string;
}
