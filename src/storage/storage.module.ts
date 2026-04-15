import { PROVISIONER_PROVIDER_STORAGE } from './interfaces/provisioner-provider-storage.interface';
import { TOURNAMENT_PROVISIONER_STORAGE } from './interfaces/tournament-provisioner-storage.interface';
import { PROVISIONER_API_KEY_STORAGE } from './interfaces/provisioner-api-key-storage.interface';
import { BOLT_HISTORY_REPORTING } from './interfaces/bolt-history-reporting.interface';
import { USER_PROVIDER_STORAGE } from './interfaces/user-provider-storage.interface';
import { PROVISIONER_STORAGE } from './interfaces/provisioner-storage.interface';
import { SSO_IDENTITY_STORAGE } from './interfaces/sso-identity-storage.interface';
import { OFFICIATING_STORAGE } from './interfaces/officiating-storage.interface';
import { SANCTIONING_STORAGE } from './interfaces/sanctioning-storage.interface';
import { BOLT_HISTORY_STORAGE } from './interfaces/bolt-history.interface';
import { TOURNAMENT_STORAGE } from './interfaces/tournament-storage.interface';
import { ASSIGNMENT_STORAGE } from './interfaces/assignment-storage.interface';
import { AUTH_CODE_STORAGE } from './interfaces/auth-code-storage.interface';
import { PROVIDER_STORAGE } from './interfaces/provider-storage.interface';
import { CALENDAR_STORAGE } from './interfaces/calendar-storage.interface';
import { AUDIT_STORAGE } from './interfaces/audit-storage.interface';
import { USER_STORAGE } from './interfaces/user-storage.interface';

import { LeveldbBoltHistoryReportingStorage } from './leveldb/leveldb-bolt-history-reporting.storage';
import { LeveldbProvisionerProviderStorage } from './leveldb/leveldb-provisioner-provider.storage';
import { LeveldbTournamentProvisionerStorage } from './leveldb/leveldb-tournament-provisioner.storage';
import { LeveldbProvisionerApiKeyStorage } from './leveldb/leveldb-provisioner-api-key.storage';
import { LeveldbUserProviderStorage } from './leveldb/leveldb-user-provider.storage';
import { LeveldbProvisionerStorage } from './leveldb/leveldb-provisioner.storage';
import { LeveldbSsoIdentityStorage } from './leveldb/leveldb-sso-identity.storage';
import { LeveldbBoltHistoryStorage } from './leveldb/leveldb-bolt-history.storage';
import { LeveldbAuditStorage } from './leveldb/leveldb-audit.storage';
import { LeveldbTournamentStorage } from './leveldb/leveldb-tournament.storage';
import { LeveldbSanctioningStorage } from './leveldb/leveldb-sanctioning.storage';
import { LeveldbOfficiatingStorage } from './leveldb/leveldb-officiating.storage';
import { LeveldbAssignmentStorage } from './leveldb/leveldb-assignment.storage';
import { LeveldbCalendarStorage } from './leveldb/leveldb-calendar.storage';
import { LeveldbProviderStorage } from './leveldb/leveldb-provider.storage';
import { LeveldbAuthCodeStorage } from './leveldb/leveldb-auth-code.storage';
import { LeveldbUserStorage } from './leveldb/leveldb-user.storage';

import { PostgresBoltHistoryReportingStorage } from './postgres/postgres-bolt-history-reporting.storage';
import { PostgresProvisionerProviderStorage } from './postgres/postgres-provisioner-provider.storage';
import { PostgresTournamentProvisionerStorage } from './postgres/postgres-tournament-provisioner.storage';
import { PostgresProvisionerApiKeyStorage } from './postgres/postgres-provisioner-api-key.storage';
import { PostgresUserProviderStorage } from './postgres/postgres-user-provider.storage';
import { PostgresProvisionerStorage } from './postgres/postgres-provisioner.storage';
import { PostgresSsoIdentityStorage } from './postgres/postgres-sso-identity.storage';
import { PostgresAuditStorage } from './postgres/postgres-audit.storage';
import { PostgresBoltHistoryStorage } from './postgres/postgres-bolt-history.storage';
import { PostgresTournamentStorage } from './postgres/postgres-tournament.storage';
import { PostgresAssignmentStorage } from './postgres/postgres-assignment.storage';
import { PostgresProviderStorage } from './postgres/postgres-provider.storage';
import { PostgresCalendarStorage } from './postgres/postgres-calendar.storage';
import { PostgresAuthCodeStorage } from './postgres/postgres-auth-code.storage';
import { PostgresUserStorage } from './postgres/postgres-user.storage';
// Note: PostgresSanctioningStorage will be added when Postgres implementation is ready
import { MigrationRunnerService } from './postgres/migration-runner.service';
import { PG_POOL, getPostgresConfig } from './postgres/postgres.config';

import { TournamentStorageService } from './tournament-storage.service';
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

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

// Officiating storage — LevelDB only for now (Postgres stub uses LevelDB)
const officiatingStorageProvider = makeStorageProvider(
  OFFICIATING_STORAGE,
  LeveldbOfficiatingStorage,
  LeveldbOfficiatingStorage,
);

// Sanctioning storage — LevelDB only for now (Postgres stub uses LevelDB)
const sanctioningStorageProvider = makeStorageProvider(
  SANCTIONING_STORAGE,
  LeveldbSanctioningStorage,
  LeveldbSanctioningStorage,
);

const boltHistoryStorageProvider = makeStorageProvider(
  BOLT_HISTORY_STORAGE,
  LeveldbBoltHistoryStorage,
  PostgresBoltHistoryStorage,
);

const boltHistoryReportingProvider = makeStorageProvider(
  BOLT_HISTORY_REPORTING,
  LeveldbBoltHistoryReportingStorage,
  PostgresBoltHistoryReportingStorage,
);

// user_providers and tournament_assignments are Postgres-only features.
// The LevelDB stubs throw on every call so misconfigured deployments fail loudly.
const userProviderStorageProvider = makeStorageProvider(
  USER_PROVIDER_STORAGE,
  LeveldbUserProviderStorage,
  PostgresUserProviderStorage,
);

const assignmentStorageProvider = makeStorageProvider(
  ASSIGNMENT_STORAGE,
  LeveldbAssignmentStorage,
  PostgresAssignmentStorage,
);

const auditStorageProvider = makeStorageProvider(
  AUDIT_STORAGE,
  LeveldbAuditStorage,
  PostgresAuditStorage,
);

const provisionerStorageProvider = makeStorageProvider(
  PROVISIONER_STORAGE,
  LeveldbProvisionerStorage,
  PostgresProvisionerStorage,
);

const provisionerApiKeyStorageProvider = makeStorageProvider(
  PROVISIONER_API_KEY_STORAGE,
  LeveldbProvisionerApiKeyStorage,
  PostgresProvisionerApiKeyStorage,
);

const provisionerProviderStorageProvider = makeStorageProvider(
  PROVISIONER_PROVIDER_STORAGE,
  LeveldbProvisionerProviderStorage,
  PostgresProvisionerProviderStorage,
);

const tournamentProvisionerStorageProvider = makeStorageProvider(
  TOURNAMENT_PROVISIONER_STORAGE,
  LeveldbTournamentProvisionerStorage,
  PostgresTournamentProvisionerStorage,
);

const ssoIdentityStorageProvider = makeStorageProvider(
  SSO_IDENTITY_STORAGE,
  LeveldbSsoIdentityStorage,
  PostgresSsoIdentityStorage,
);

@Global()
@Module({
  providers: [
    pgPoolProvider,
    MigrationRunnerService,
    tournamentStorageProvider,
    userStorageProvider,
    providerStorageProvider,
    calendarStorageProvider,
    authCodeStorageProvider,
    officiatingStorageProvider,
    sanctioningStorageProvider,
    boltHistoryStorageProvider,
    boltHistoryReportingProvider,
    userProviderStorageProvider,
    assignmentStorageProvider,
    auditStorageProvider,
    provisionerStorageProvider,
    provisionerApiKeyStorageProvider,
    provisionerProviderStorageProvider,
    tournamentProvisionerStorageProvider,
    ssoIdentityStorageProvider,
    TournamentStorageService,
  ],
  exports: [
    TOURNAMENT_STORAGE,
    USER_STORAGE,
    PROVIDER_STORAGE,
    CALENDAR_STORAGE,
    AUTH_CODE_STORAGE,
    OFFICIATING_STORAGE,
    SANCTIONING_STORAGE,
    BOLT_HISTORY_STORAGE,
    BOLT_HISTORY_REPORTING,
    USER_PROVIDER_STORAGE,
    ASSIGNMENT_STORAGE,
    AUDIT_STORAGE,
    PROVISIONER_STORAGE,
    PROVISIONER_API_KEY_STORAGE,
    PROVISIONER_PROVIDER_STORAGE,
    TOURNAMENT_PROVISIONER_STORAGE,
    SSO_IDENTITY_STORAGE,
    TournamentStorageService,
  ],
})
export class StorageModule {}
