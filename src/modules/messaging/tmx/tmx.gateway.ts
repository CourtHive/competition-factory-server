import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer, ConnectedSocket } from '@nestjs/websockets';
import { UseGuards, Logger, Inject, Injectable } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/modules/auth/guards/socket.guard';
import { tmxMessages } from './tmxMessages';
import { Server, Socket } from 'socket.io';

@Injectable()
@UseGuards(SocketGuard) // SocketGuard handles authentication as well as roles
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'tmx',
})
export class TmxGateway {
  // constructor() {} // private readonly configService: ConfigService,
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  private readonly logger = new Logger(TmxGateway.name);

  @WebSocketServer()
  server?: Server;

  @SubscribeMessage('executionQueue')
  @Roles(['client'])
  async messageHandler(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<any> {
    if (typeof data !== 'object') return { notFound: data };
    const { type, payload = {} } = data;
    this.logger.debug(`executionQueue route successful`);
    if (tmxMessages[type]) {
      return tmxMessages[type]({ client, payload });
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
    if (data?.payload?.cache) {
      const cachedData = await this.cacheManager.get(data.payload.cache);
      if (!cachedData) {
        console.log({ cachedData: 'not found' });
        await this.cacheManager.set(data.payload.cache, data.payload, data.payload.ttl);
      } else {
        console.log({ cachedData });
      }
    }

    this.logger.debug(`test route successful`);
    return { event: 'ack', data }; // emit to client
  }
}