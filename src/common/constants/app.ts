export enum Environment {
  Development = 'development',
  Production = 'production',
  Staging = 'stage',
  Testing = 'test',
  Local = 'local',
}

export enum ConfigKey {
  App = 'APP',
  Db = 'DB',
}

export const SUCCESS = { success: true };

// Returned by the tournament storage save path when the writer's owner_epoch is
// lower than the epoch recorded on the row — i.e. this process was deposed as
// owner of the tournament and its in-hand record represents a history that no
// longer exists. Distinct from a generic persistence failure because the correct
// response is different: never retry, never re-fetch-and-reapply, discard the
// record and re-resolve the route. See migration 042.
export const FENCED_BY_NEWER_OWNER = 'Fenced: tournament is owned by a newer epoch';
export const STORAGE = './storage';
export const UTF8 = 'utf8';
