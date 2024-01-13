// import { ConfigService } from '@nestjs/config';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
  ConnectedSocket,
} from '@nestjs/websockets';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Server, Socket } from 'socket.io';
import { messages } from './messages';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'mobile',
})
export class TrackerGateway {
  // constructor(private readonly configService: ConfigService) {}

  @WebSocketServer()
  server?: Server;

  @SubscribeMessage('events')
  findAll(@MessageBody() data: any): Observable<WsResponse<number>> {
    return from([1, 2, 3]).pipe(map((iteration) => ({ event: 'events', data, iteration })));
  }

  @SubscribeMessage('identity')
  async identity(@MessageBody() data: number): Promise<number> {
    return data;
  }

  @SubscribeMessage('mh')
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
}
