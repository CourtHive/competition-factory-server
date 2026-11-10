import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { ADMIN, CLIENT, PROVIDER_ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { normalizeTeamPalette, type Participant } from 'tods-competition-factory';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { providerTeamColorPlan } from './team-display.contract';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { Pool } from 'pg';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

/** ILIKE treats `%`, `_` and `\` as pattern syntax; a search term must match them literally. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Public-safe team identity defaults. No provider permissions, keys or contacts cross this boundary. */
@UseGuards(RolesGuard)
@Controller('provider')
export class TeamDisplayController {
  private readonly logger = new Logger(TeamDisplayController.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Bounded safe directory: names/IDs only, not every provider record or every stored palette. */
  @Get('team-displays')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  async list(@Query('q') query = '', @Query('offset') offset = '0') {
    const start = Number(offset);
    if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(start) || start < 0)
      throw new BadRequestException('Invalid team display search');
    const { rows } = await this.pool.query(
      "SELECT provider_id, organisation_name FROM providers WHERE data ? 'teamColors' AND (organisation_name ILIKE $1 ESCAPE '\\' OR provider_id = $2) ORDER BY organisation_name, provider_id LIMIT 51 OFFSET $3",
      [`%${escapeLikeTerm(query.trim())}%`, query.trim(), start],
    );
    return {
      teams: rows
        .slice(0, 50)
        .map((row) => ({ participantId: row.provider_id, participantName: row.organisation_name ?? row.provider_id })),
      ...(rows.length > 50 && { nextOffset: start + 50 }),
    };
  }

  @Get(':providerId/team-display')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  async get(@Param('providerId') providerId: string): Promise<{ participant: Participant }> {
    const { rows } = await this.pool.query(
      "SELECT provider_id, organisation_name, data->'teamColors' AS team_colors FROM providers WHERE provider_id = $1",
      [providerId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Team provider not found');
    const teamColors = row.team_colors == null ? undefined : normalizeTeamPalette(row.team_colors);
    if (row.team_colors != null && !teamColors) {
      // The request is fine; the STORED record is not. That is a server-side data fault, so it is a 500
      // and an ERROR line an operator can find, never a 400 that blames the caller.
      this.logger.error(`Stored teamColors for provider ${providerId} fail CODES validation`);
      throw new InternalServerErrorException('Stored provider team display is invalid');
    }
    return {
      participant: {
        participantId: row.provider_id,
        participantType: 'TEAM',
        participantRole: 'COMPETITOR',
        participantName: row.organisation_name ?? row.provider_id,
        ...(teamColors && { teamColors }),
      },
    };
  }

  @Put(':providerId/team-display')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  async put(
    @Param('providerId') providerId: string,
    @Body() body: { teamColors: unknown },
    @UserCtx() ctx: UserContext,
  ) {
    if (!ctx?.isSuperAdmin && ctx?.providerRoles?.[providerId] !== PROVIDER_ADMIN)
      throw new ForbiddenException('PROVIDER_ADMIN role required for this team provider');
    const { clear, colors } = providerTeamColorPlan(body?.teamColors);
    // A surgical JSONB update preserves simultaneous edits to unrelated provider data.
    const result = clear
      ? await this.pool.query(
          "UPDATE providers SET data = COALESCE(data, '{}'::jsonb) - 'teamColors', updated_at = NOW() WHERE provider_id = $1",
          [providerId],
        )
      : await this.pool.query(
          "UPDATE providers SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{teamColors}', $2::jsonb, true), updated_at = NOW() WHERE provider_id = $1",
          [providerId, JSON.stringify(colors)],
        );
    if (!result.rowCount) throw new NotFoundException('Team provider not found');
    return { success: true };
  }
}
