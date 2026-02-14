import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer, ConnectedSocket } from '@nestjs/websockets';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { UseGuards, Logger, Inject, Injectable } from '@nestjs/common';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/modules/auth/guards/socket.guard';
import { Public } from '../../auth/decorators/public.decorator';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { tools } from 'tods-competition-factory';
import { tmxMessages } from './tmxMessages';
import { Server, Socket } from 'socket.io';

@Injectable()
@UseGuards(SocketGuard) // SocketGuard handles authentication as well as roles
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'tmx',
})
export class TmxGateway {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  private readonly logger = new Logger(TmxGateway.name);

  @WebSocketServer()
  server?: Server;

  @SubscribeMessage('executionQueue')
  @Roles([CLIENT, SUPER_ADMIN])
  async messageHandler(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<any> {
    if (typeof data !== 'object') return { notFound: data };
    const { type, payload = {} } = data;
    if (tmxMessages[type]) {
      const methods = tools.unique(payload?.methods?.map((directive) => directive.method) ?? []).join('|');
      try {
        const result = await tmxMessages[type]({
          client,
          payload,
          services: { cacheManager: this.cacheManager },
          storage: this.tournamentStorageService,
        });
        if (result.error) {
          const tournamentInfo = result.tournamentIds ? ` | tournaments: ${JSON.stringify(result.tournamentIds)}` : '';
          this.logger.error(`${type} message errored: ${payload.userId}: ${methods}${tournamentInfo} | error: ${JSON.stringify(result.error)}`);
        } else {
          this.logger.debug(`${type} message successful: ${payload.userId}: ${methods}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`${type} message threw: ${payload.userId}: ${methods} | error: ${message}`);
        const ackId = payload?.ackId;
        client.emit('ack', { ackId, error: message });
      }
    } else {
      this.logger.debug(`Not found: ${type}`);
    }
  }

  @SubscribeMessage('tmx')
  @Roles([CLIENT, SUPER_ADMIN])
  async tmx(@MessageBody() data: any): Promise<any> {
    this.logger.debug(`tmx message successful -- no action taken (yet)`, { data });
    return { event: 'ack', data }; // emit to client
  }

  @SubscribeMessage('timestamp')
  @Roles([CLIENT, SUPER_ADMIN])
  async timestamp(@MessageBody() data: any): Promise<any> {
    this.logger.verbose(`client timestamp: ${data.timestamp}`);
    return { event: 'timestamp', data: { timestamp: new Date().getTime() } }; // emit to client
  }

  @SubscribeMessage('test')
  @Public()
  async test(@MessageBody() data: any): Promise<any> {
    if (data?.payload?.cache && typeof data.payload.cache === 'string') {
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
