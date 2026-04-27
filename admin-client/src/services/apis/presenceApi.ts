import { baseApi } from './baseApi';

export interface PresenceMember {
  socketId: string;
  userId?: string;
  email?: string;
  providerId?: string;
  providerName?: string;
  providerAbbreviation?: string;
  joinedAt?: number;
}

export interface PresenceRoom {
  tournamentId: string;
  count: number;
  members: PresenceMember[];
}

export interface PresenceResponse {
  takenAt: number;
  totalSockets: number;
  rooms: PresenceRoom[];
}

/** Snapshot of every active TMX tournament Socket.IO room. Super-admin only. */
export async function getPresence(): Promise<PresenceResponse | null> {
  const res = await baseApi.get('/admin/presence');
  return res?.data ?? null;
}
