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

import { PostgresBoltHistoryReportingStorage } from './postgres/postgres-bolt-history-reporting.storage';
import { PostgresProvisionerProviderStorage } from './postgres/postgres-provisioner-provider.storage';
import { PostgresTournamentProvisionerStorage } from './postgres/postgres-tournament-provisioner.storage';
import { PostgresProvisionerApiKeyStorage } from './postgres/postgres-provisioner-api-key.storage';
import { PostgresUserProviderStorage } from './postgres/postgres-user-provider.storage';
import { PostgresProvisionerStorage } from './postgres/postgres-provisioner.storage';
import { PostgresSsoIdentityStorage } from './postgres/postgres-sso-identity.storage';
import { PostgresSanctioningStorage } from './postgres/postgres-sanctioning.storage';
import { PostgresOfficiatingStorage } from './postgres/postgres-officiating.storage';
import { PostgresAuditStorage } from './postgres/postgres-audit.storage';
import { PostgresBoltHistoryStorage } from './postgres/postgres-bolt-history.storage';
import { PostgresTournamentStorage } from './postgres/postgres-tournament.storage';
import { PostgresAssignmentStorage } from './postgres/postgres-assignment.storage';
import { PostgresProviderStorage } from './postgres/postgres-provider.storage';
import { PostgresCalendarStorage } from './postgres/postgres-calendar.storage';
import { PostgresAuthCodeStorage } from './postgres/postgres-auth-code.storage';
import { PostgresUserStorage } from './postgres/postgres-user.storage';
import { MigrationRunnerService } from './postgres/migration-runner.service';
import { PG_POOL, getPostgresConfig } from './postgres/postgres.config';

import { TournamentStorageService } from './tournament-storage.service';
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

const pgPoolProvider = {
  provide: PG_POOL,
  useFactory: () => new Pool(getPostgresConfig()),
};

function makeStorageProvider(token: symbol, storageClass: any) {
  return {
    provide: token,
    useFactory: (pool: Pool) => new storageClass(pool),
    inject: [PG_POOL],
  };
}

const tournamentStorageProvider = makeStorageProvider(TOURNAMENT_STORAGE, PostgresTournamentStorage);
const userStorageProvider = makeStorageProvider(USER_STORAGE, PostgresUserStorage);
const providerStorageProvider = makeStorageProvider(PROVIDER_STORAGE, PostgresProviderStorage);
const calendarStorageProvider = makeStorageProvider(CALENDAR_STORAGE, PostgresCalendarStorage);
const authCodeStorageProvider = makeStorageProvider(AUTH_CODE_STORAGE, PostgresAuthCodeStorage);
const officiatingStorageProvider = makeStorageProvider(OFFICIATING_STORAGE, PostgresOfficiatingStorage);
const sanctioningStorageProvider = makeStorageProvider(SANCTIONING_STORAGE, PostgresSanctioningStorage);
const boltHistoryStorageProvider = makeStorageProvider(BOLT_HISTORY_STORAGE, PostgresBoltHistoryStorage);
const boltHistoryReportingProvider = makeStorageProvider(BOLT_HISTORY_REPORTING, PostgresBoltHistoryReportingStorage);
const userProviderStorageProvider = makeStorageProvider(USER_PROVIDER_STORAGE, PostgresUserProviderStorage);
const assignmentStorageProvider = makeStorageProvider(ASSIGNMENT_STORAGE, PostgresAssignmentStorage);
const auditStorageProvider = makeStorageProvider(AUDIT_STORAGE, PostgresAuditStorage);
const provisionerStorageProvider = makeStorageProvider(PROVISIONER_STORAGE, PostgresProvisionerStorage);
const provisionerApiKeyStorageProvider = makeStorageProvider(PROVISIONER_API_KEY_STORAGE, PostgresProvisionerApiKeyStorage);
const provisionerProviderStorageProvider = makeStorageProvider(PROVISIONER_PROVIDER_STORAGE, PostgresProvisionerProviderStorage);
const tournamentProvisionerStorageProvider = makeStorageProvider(TOURNAMENT_PROVISIONER_STORAGE, PostgresTournamentProvisionerStorage);
const ssoIdentityStorageProvider = makeStorageProvider(SSO_IDENTITY_STORAGE, PostgresSsoIdentityStorage);

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
    PG_POOL,
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
