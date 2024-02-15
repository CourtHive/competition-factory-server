import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/modules/auth/guards/socket.guard';
import { trackerMessages } from './trackerMessages';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
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
    if (trackerMessages[type]) {
      return trackerMessages[type]({ client, payload });
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
