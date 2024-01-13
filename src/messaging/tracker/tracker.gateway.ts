import { Public } from '../../auth/decorators/public.decorator';
import { SocketGuard } from 'src/auth/guards/socket.guard';
import { ConfigService } from '@nestjs/config';
import { UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { messages } from './messages';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
  ConnectedSocket,
} from '@nestjs/websockets';

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

  @WebSocketServer()
  server?: Server;

  async handleConnection(client: Socket) {
    console.log({ connectionHeaders: client.handshake.headers });
    // const payload = this.usersService.verify(client.handshake.headers.authorization);
    // const user = await this.usersService.findOne(payload.userId);
    // !user && client.disconnect();
  }

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
      console.log({ notFound: type }, data);
    }
    return { notFound: type };
  }

  @SubscribeMessage('test')
  async test(@MessageBody() data: any): Promise<any> {
    console.log({ data });
    return data;
  }
}
