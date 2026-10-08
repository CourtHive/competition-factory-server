import type { RealtimeChannel } from './realtime.types';

/**
 * The room naming scheme, in one place. These strings are the topics a second
 * transport has to reproduce, so nothing outside this file should concatenate
 * a prefix onto an id.
 */
export const TOURNAMENT_ROOM_PREFIX = 'tournament:';
export const PUBLIC_TOURNAMENT_ROOM_PREFIX = 'public:tournament:';
export const PERSON_ROOM_PREFIX = 'hiveid:person:';
export const ADMIN_CHAT_MONITOR_ROOM = 'admin:chatMonitor';

/** TMX operators viewing a tournament: mutations, chat, presence, facility fan-out. */
export function tournamentChannel(tournamentId: string): RealtimeChannel {
  return { namespace: 'tmx', room: TOURNAMENT_ROOM_PREFIX + tournamentId };
}

/** Super-admins watching chat across every tournament. */
export function adminChatMonitorChannel(): RealtimeChannel {
  return { namespace: 'tmx', room: ADMIN_CHAT_MONITOR_ROOM };
}

/** Anonymous public viewers of a tournament: sanitized updates and live scores. */
export function publicTournamentChannel(tournamentId: string): RealtimeChannel {
  return { namespace: 'public', room: PUBLIC_TOURNAMENT_ROOM_PREFIX + tournamentId };
}

/** A HiveID user's own person-scoped updates. */
export function personChannel(personId: string): RealtimeChannel {
  return { namespace: 'hiveid', room: PERSON_ROOM_PREFIX + personId };
}
