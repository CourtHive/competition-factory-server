import { UserCtx, type UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { TournamentChatService, type ChatSendInput } from './tournament-chat.service';
import { Roles } from 'src/modules/account/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/account/auth/guards/role.guard';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';

/**
 * Tournament chat over HTTP — realtime transport Phase 1. The same send as the socket's
 * `chatMessage`; the answer is what the socket would emit to the sender: `{ accepted }` for
 * `chatAccepted`, `{ rejected }` for `chatRejected`.
 */
@Controller('tmx/chat')
@UseGuards(RolesGuard)
export class TmxChatController {
  constructor(private readonly chat: TournamentChatService) {}

  @Post()
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  send(@Body() body: ChatSendInput, @Req() req: any, @UserCtx() userContext?: UserContext) {
    return this.chat.send(body, { userContext, verifiedUser: req.user });
  }
}
