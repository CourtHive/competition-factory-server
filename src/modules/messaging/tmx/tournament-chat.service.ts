import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { tournamentChannel, adminChatMonitorChannel } from '../realtime/channels';
import { MAX_CHAT_MESSAGE_LENGTH, toAdminFeed, toWireMessage } from './chatWire';
import { AssignmentsService } from 'src/modules/factory/assignments.service';
import { CHAT_STORAGE, type IChatStorage } from 'src/storage/interfaces';
import { userCanViewTournament } from './tournamentVisibility';
import { Inject, Injectable, Logger } from '@nestjs/common';

// types
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import type { RealtimePublisher } from '../realtime/realtime.types';
import type { VerifiedUser } from './stampOperatorAttribution';

// constants
import { REALTIME_PUBLISHER } from '../realtime/realtime.types';

export interface ChatSendInput {
  tournamentId?: string;
  message?: unknown;
  clientMsgId?: string;
  userName?: string;
  providerId?: string;
  providerAbbr?: string;
  tournamentName?: string;
}

export interface ChatSender {
  userContext?: UserContext;
  verifiedUser?: VerifiedUser;
  /** The sender's realtime connection, when it sent over one; the relay skips it. */
  excludeConnectionId?: string;
}

export type ChatSendResult =
  | { accepted: { clientMsgId?: string; seq: number; timestamp: number } }
  | { rejected: { clientMsgId?: string; error: string } }
  | { ignored: true };

/**
 * A tournament chat message, sent over the socket (`chatMessage`) or over HTTP (`POST /tmx/chat`):
 * one implementation for both (realtime transport Phase 1).
 *
 * Over HTTP there is no sender connection to exclude, so the sender also receives the relay. TMX
 * reconciles a relayed copy of its own message by `clientMsgId` (chatService `receiveMessage`), so
 * that renders nothing twice.
 */
@Injectable()
export class TournamentChatService {
  private readonly logger = new Logger(TournamentChatService.name);

  constructor(
    @Inject(CHAT_STORAGE) private readonly chatStorage: IChatStorage,
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
  ) {}

  async send(input: ChatSendInput, sender: ChatSender): Promise<ChatSendResult> {
    const tournamentId = input?.tournamentId;
    const message = typeof input?.message === 'string' ? input.message.slice(0, MAX_CHAT_MESSAGE_LENGTH) : '';
    if (!tournamentId || !message.trim()) return { ignored: true };
    const clientMsgId = input.clientMsgId;

    // The room's own rule. Posting to a tournament's chat was gated by nothing but the CLIENT role,
    // so a caller who could not join the room could still write into it.
    const canView = await userCanViewTournament({
      tournamentId,
      userContext: sender.userContext,
      storage: this.tournamentStorageService,
      assignments: this.assignmentsService,
    });
    if (!canView) {
      this.logger.warn(`[chat] denied for ${sender.verifiedUser?.email} — cannot view ${tournamentId}`);
      return { rejected: { clientMsgId, error: 'Not authorized to view this tournament' } };
    }

    // Persist first: the assigned seq is the ordering key backfill and gap detection depend on, so
    // only what was durably stored is relayed. The author is who the token says, not the client.
    const { record, error } = await this.chatStorage.appendMessage({
      tournamentId,
      providerId: input.providerId,
      providerAbbr: input.providerAbbr,
      tournamentName: input.tournamentName,
      userName: sender.verifiedUser?.email ?? input.userName ?? 'Anonymous',
      message,
      clientMsgId,
    });
    if (error || !record) {
      this.logger.warn(`[chat] persist failed for ${tournamentId}: ${error}`);
      return { rejected: { clientMsgId, error: error ?? 'persist failed' } };
    }

    const wire = toWireMessage(record);
    this.publisher.publish(tournamentChannel(tournamentId), 'chatMessage', wire, {
      excludeConnectionId: sender.excludeConnectionId,
    });
    // Mirror to the super-admin monitor room (live cross-tournament feed).
    this.publisher.publish(adminChatMonitorChannel(), 'adminChatFeed', toAdminFeed(record));

    return { accepted: { clientMsgId: record.clientMsgId, seq: record.seq, timestamp: wire.timestamp } };
  }
}
