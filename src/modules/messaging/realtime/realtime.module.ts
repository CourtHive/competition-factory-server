import { REALTIME_PRESENCE, REALTIME_PUBLISHER } from './realtime.types';
import { SocketIoRealtimeAdapter } from './socket-io-realtime.adapter';
import { Module } from '@nestjs/common';

/**
 * Provides the realtime port. Selecting a transport means changing the two
 * `useExisting` bindings below; nothing that injects the tokens changes.
 */
@Module({
  providers: [
    SocketIoRealtimeAdapter,
    { provide: REALTIME_PUBLISHER, useExisting: SocketIoRealtimeAdapter },
    { provide: REALTIME_PRESENCE, useExisting: SocketIoRealtimeAdapter },
  ],
  exports: [SocketIoRealtimeAdapter, REALTIME_PUBLISHER, REALTIME_PRESENCE],
})
export class RealtimeModule {}
