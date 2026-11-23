import { scoreRequest } from './scoreRequest';
import {
  Body,
  BadRequestException,
  CanActivate,
  Controller,
  Header,
  HttpCode,
  Injectable,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { OperatorMatchService } from './operator-match.service';
import { checkedObject, matchRequest, validOperatorId } from './matchRequest';

@Injectable()
export class OperatorMatchEnabled implements CanActivate {
  canActivate(): boolean {
    if (process.env.OPERATOR_MATCH_ENABLED !== 'true') throw new NotFoundException();
    return true;
  }
}
@Controller('operator')
@UseGuards(OperatorMatchEnabled)
export class OperatorController {
  constructor(private readonly matches: OperatorMatchService) {}
  @Post('catalogue-access')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  catalogue(@Body() body: unknown, @UserCtx() user?: UserContext) {
    const { tournamentIds } = checkedObject(body, ['tournamentIds']);
    if (!Array.isArray(tournamentIds) || tournamentIds.length > 101 || !tournamentIds.every(validOperatorId))
      throw new BadRequestException('Invalid tournament identifiers');
    return this.matches.catalogueAccess([...new Set<string>(tournamentIds)], user);
  }

  @Post('match')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  match(@Body() body: unknown, @UserCtx() user?: UserContext) {
    return this.matches.read(matchRequest(body), user);
  }
  @Post('score')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  score(@Body() body: unknown, @UserCtx() user?: UserContext) {
    return this.matches.score(scoreRequest(body), user);
  }
}
