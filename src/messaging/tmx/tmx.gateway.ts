import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer, ConnectedSocket } from '@nestjs/websockets';
import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/auth/guards/socket.guard';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { messages } from './messages';

@UseGuards(SocketGuard) // SocketGuard handles authentication as well as roles
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'tmx',
})
export class TmxGateway {
  constructor() {} // private readonly configService: ConfigService,

  private readonly logger = new Logger(TmxGateway.name);

  @WebSocketServer()
  server?: Server;

  @SubscribeMessage('executionQueue')
  @Roles(['client'])
  async messageHandler(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<any> {
    if (typeof data !== 'object') return { notFound: data };
    const { type, payload = {} } = data;
    this.logger.debug(`executionQueue route successful`);
    if (messages[type]) {
      return messages[type]({ client, payload });
    } else {
      this.logger.debug(`Not found: ${type}`);
    }
    return { notFound: type };
  }

  @SubscribeMessage('tmx')
  @Roles(['client'])
  async tmx(@MessageBody() data: any): Promise<any> {
    this.logger.debug(`tmx route successful`, { data });
    return { event: 'ack', data }; // emit to client
  }

  @SubscribeMessage('timestamp')
  @Roles(['client'])
  async timestamp(): Promise<any> {
    return { event: 'timestamp', data: { timestamp: new Date().getTime() } }; // emit to client
  }

  @SubscribeMessage('test')
  @Public()
  async test(@MessageBody() data: any): Promise<any> {
    this.logger.debug(`test route successful`);
    return { event: 'ack', data }; // emit to client
  }
}
