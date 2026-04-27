import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { RolesGuard } from 'src/modules/auth/guards/role.guard';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { SUPER_ADMIN } from 'src/common/constants/roles';

import { TmxGateway, type RoomPresence } from './tmx.gateway';
import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';

export interface AdminPresenceMember {
  socketId: string;
  userId?: string;
  email?: string;
  providerId?: string;
  providerName?: string;
  providerAbbreviation?: string;
  joinedAt?: number;
}

export interface AdminPresenceRoom {
  tournamentId: string;
  count: number;
  members: AdminPresenceMember[];
}

export interface AdminPresenceResponse {
  takenAt: number;
  totalSockets: number;
  rooms: AdminPresenceRoom[];
}

/**
 * Read-only snapshot of the live Socket.IO `tournament:` rooms in the TMX
 * gateway. Used by the admin "Active Rooms" panel to see who is currently
 * looking at which tournament. Super-admin only.
 */
@Controller('admin/presence')
@UseGuards(RolesGuard)
@Roles([SUPER_ADMIN])
export class AdminPresenceController {
  constructor(
    private readonly tmxGateway: TmxGateway,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
  ) {}

  @Get()
  async list(): Promise<AdminPresenceResponse> {
    const rooms = await this.tmxGateway.getActiveRoomPresence();
    const enriched = await this.enrich(rooms);
    const totalSockets = enriched.reduce((sum, r) => sum + r.count, 0);
    return { takenAt: Date.now(), totalSockets, rooms: enriched };
  }

  /**
   * Look up provider name/abbreviation for every distinct providerId in the
   * snapshot — one DB hit per provider, not per socket.
   */
  private async enrich(rooms: RoomPresence[]): Promise<AdminPresenceRoom[]> {
    const providerIds = new Set<string>();
    for (const room of rooms) {
      for (const member of room.members) {
        if (member.providerId) providerIds.add(member.providerId);
      }
    }

    const providerById = new Map<string, { organisationName?: string; organisationAbbreviation?: string }>();
    await Promise.all(
      Array.from(providerIds).map(async (providerId) => {
        try {
          const provider = await this.providerStorage.getProvider(providerId);
          if (provider) {
            providerById.set(providerId, {
              organisationName: provider.organisationName,
              organisationAbbreviation: provider.organisationAbbreviation,
            });
          }
        } catch {
          // skip — provider lookup is best-effort, the panel still shows providerId
        }
      }),
    );

    return rooms.map((room) => ({
      tournamentId: room.tournamentId,
      count: room.count,
      members: room.members.map((m) => {
        const provider = m.providerId ? providerById.get(m.providerId) : undefined;
        return {
          socketId: m.socketId,
          userId: m.userId,
          email: m.email,
          providerId: m.providerId,
          providerName: provider?.organisationName,
          providerAbbreviation: provider?.organisationAbbreviation,
          joinedAt: m.joinedAt,
        };
      }),
    }));
  }
}
