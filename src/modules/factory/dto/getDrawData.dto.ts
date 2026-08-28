import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetDrawDataDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  drawId: string = '';

  /**
   * How much of each structure to return — `'FULL'` (default) or `'STUBS'`.
   * `STUBS` omits roundMatchUps and seedAssignments; see the factory's query-governor docs.
   */
  @ApiPropertyOptional({ enum: ['FULL', 'STUBS'] })
  structuresProfile?: string;

  /**
   * Whether each side carries a fully-hydrated `participant`.
   *
   * `false` leaves `side.participantId` plus a small draw-scoped stub (`entryStage`, `entryStatus`,
   * `luckyAdvancement`) and drops the person data — measured at 11.4% of a real singles draw and
   * 50.6% of a doubles fixture, because pair participants inline their `individualParticipants`.
   *
   * For a client that already holds the tournament participant set (see `participantsVersion` on
   * eventdata) this is the same information for far fewer bytes: it rehydrates sides from the map it
   * already has. Omit the field to get today's fully-hydrated payload.
   */
  @ApiPropertyOptional()
  hydrateParticipants?: boolean;
}
