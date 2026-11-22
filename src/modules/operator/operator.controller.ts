import { scoreRequest } from './scoreRequest';
import {
  Body,
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
import { matchRequest } from './matchRequest';

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
