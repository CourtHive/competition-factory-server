import { Public } from '../../auth/decorators/public.decorator';
import { SocketGuard } from 'src/auth/guards/socket.guard';
import { ConfigService } from '@nestjs/config';
import { UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { from, Observable } from 'rxjs';
import { Logger } from '@nestjs/common';
import { messages } from './messages';
import { map } from 'rxjs/operators';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Roles } from 'src/auth/decorators/roles.decorator';

@UseGuards(SocketGuard)
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'mobile',
})
export class TrackerGateway {
  constructor(
    private readonly configService: ConfigService,
    // private usersService: UsersService,
    // private authService: AuthService,
  ) {}

  private readonly logger = new Logger(TrackerGateway.name);

  @WebSocketServer()
  server?: Server;

  /*
  // EXAMPLE usage
  async handleConnection(client: Socket) {
    console.log({ auth: !!client.handshake.headers?.authorization });
    // const payload = this.usersService.verify(client.handshake.headers.authorization);
    // const user = await this.usersService.findOne(payload.userId);
    // !user && client.disconnect();
  }
  */

  @SubscribeMessage('events')
  @Public()
  findAll(@MessageBody() data: any): Observable<WsResponse<number>> {
    const tracker = this.configService.get('tracker');
    console.log({ tracker });
    return from([1, 2, 3]).pipe(map((iteration) => ({ event: 'events', data, iteration })));
  }

  @SubscribeMessage('identity')
  @Public()
  async identity(@MessageBody() data: number): Promise<number> {
    return data;
  }

  @SubscribeMessage('mh')
  @Public()
  async messageHandler(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<any> {
    if (typeof data !== 'object') return { notFound: data };
    const { type, payload = {} } = data;
    if (messages[type]) {
      return messages[type]({ client, payload });
    } else {
      this.logger.debug(`Not found: ${type}`);
    }
    return { notFound: type };
  }

  @SubscribeMessage('test')
  @Roles(['client'])
  // not @Public() so requires auth
  async test(@MessageBody() data: any): Promise<any> {
    this.logger.debug(`test route successful`);
    return { event: 'ack', data }; // emit to client
  }
}
