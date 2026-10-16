import { ApiPropertyOptional } from '@nestjs/swagger';

export class SaveTournamentRecordsDto {
  @ApiPropertyOptional()
  tournamentRecords?: any;

  @ApiPropertyOptional()
  tournamentRecord?: any;

  /** Stable retry key, scoped to the authenticated actor: a resend returns the original answer. Reuse only for an identical body. */
  @ApiPropertyOptional()
  commandId?: string;

  /**
   * Per tournament, the `serverUpdatedAt` the caller last saw, or null for "must not exist yet". A tournament written
   * since is refused with 409 instead of overwritten. Tournaments not named are saved unconditionally.
   */
  @ApiPropertyOptional()
  expectedServerUpdatedAt?: Record<string, string | null>;
}
