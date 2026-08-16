import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExecutionQueueDto {
  @ApiPropertyOptional()
  tournamentIds?: string[];

  @ApiPropertyOptional()
  tournamentId?: string;

  @ApiProperty()
  methods: any[] = [];

  /**
   * Opt in to re-seeding the per-event payloads this mutation evicts, so the first public reader
   * does not pay a cache miss. Set it when a reader is imminent — releasing a draw — and leave it
   * off for draft, administrative or bulk republish work, where building the payload is pure waste.
   *
   * CFS-only: the factory never sees this field. Default false.
   */
  @ApiPropertyOptional()
  warmCache?: boolean;
}
