import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

import { TOURNAMENT_STORAGE } from './interfaces/tournament-storage.interface';
import { USER_STORAGE } from './interfaces/user-storage.interface';
import { PROVIDER_STORAGE } from './interfaces/provider-storage.interface';
import { CALENDAR_STORAGE } from './interfaces/calendar-storage.interface';
import { AUTH_CODE_STORAGE } from './interfaces/auth-code-storage.interface';

import { LeveldbTournamentStorage } from './leveldb/leveldb-tournament.storage';
import { LeveldbUserStorage } from './leveldb/leveldb-user.storage';
import { LeveldbProviderStorage } from './leveldb/leveldb-provider.storage';
import { LeveldbCalendarStorage } from './leveldb/leveldb-calendar.storage';
import { LeveldbAuthCodeStorage } from './leveldb/leveldb-auth-code.storage';

import { PostgresTournamentStorage } from './postgres/postgres-tournament.storage';
import { PostgresUserStorage } from './postgres/postgres-user.storage';
import { PostgresProviderStorage } from './postgres/postgres-provider.storage';
import { PostgresCalendarStorage } from './postgres/postgres-calendar.storage';
import { PostgresAuthCodeStorage } from './postgres/postgres-auth-code.storage';
import { PG_POOL, getPostgresConfig } from './postgres/postgres.config';

import { TournamentStorageService } from './tournament-storage.service';

type StorageProvider = 'leveldb' | 'postgres';

function getStorageProvider(): StorageProvider {
  return (process.env.STORAGE_PROVIDER as StorageProvider) || 'leveldb';
}

// Postgres Pool — only created when provider is 'postgres'
const pgPoolProvider = {
  provide: PG_POOL,
  useFactory: () => {
    if (getStorageProvider() !== 'postgres') return null;
    return new Pool(getPostgresConfig());
  },
};

function makeStorageProvider(token: symbol, leveldbClass: any, postgresClass: any) {
  return {
    provide: token,
    useFactory: (pool?: Pool) => {
      const provider = getStorageProvider();
      if (provider === 'postgres') {
        return new postgresClass(pool);
      }
      return new leveldbClass();
    },
    inject: [PG_POOL],
  };
}

const tournamentStorageProvider = makeStorageProvider(
  TOURNAMENT_STORAGE,
  LeveldbTournamentStorage,
  PostgresTournamentStorage,
);

const userStorageProvider = makeStorageProvider(
  USER_STORAGE,
  LeveldbUserStorage,
  PostgresUserStorage,
);

const providerStorageProvider = makeStorageProvider(
  PROVIDER_STORAGE,
  LeveldbProviderStorage,
  PostgresProviderStorage,
);

const calendarStorageProvider = makeStorageProvider(
  CALENDAR_STORAGE,
  LeveldbCalendarStorage,
  PostgresCalendarStorage,
);

const authCodeStorageProvider = makeStorageProvider(
  AUTH_CODE_STORAGE,
  LeveldbAuthCodeStorage,
  PostgresAuthCodeStorage,
);

@Global()
@Module({
  providers: [
    pgPoolProvider,
    tournamentStorageProvider,
    userStorageProvider,
    providerStorageProvider,
    calendarStorageProvider,
    authCodeStorageProvider,
    TournamentStorageService,
  ],
  exports: [
    TOURNAMENT_STORAGE,
    USER_STORAGE,
    PROVIDER_STORAGE,
    CALENDAR_STORAGE,
    AUTH_CODE_STORAGE,
    TournamentStorageService,
  ],
})
export class StorageModule {}
