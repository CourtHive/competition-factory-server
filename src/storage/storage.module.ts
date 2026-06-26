import { PROVISIONER_PROVIDER_STORAGE } from './interfaces/provisioner-provider-storage.interface';
import { TOURNAMENT_PROVISIONER_STORAGE } from './interfaces/tournament-provisioner-storage.interface';
import { PROVISIONER_API_KEY_STORAGE } from './interfaces/provisioner-api-key-storage.interface';
import { PROVIDER_API_KEY_STORAGE } from './interfaces/provider-api-key-storage.interface';
import { BOLT_HISTORY_REPORTING } from './interfaces/bolt-history-reporting.interface';
import { USER_PROVIDER_STORAGE } from './interfaces/user-provider-storage.interface';
import { PROVISIONER_STORAGE } from './interfaces/provisioner-storage.interface';
import { SSO_IDENTITY_STORAGE } from './interfaces/sso-identity-storage.interface';
import { USER_PROVISIONER_STORAGE } from './interfaces/user-provisioner-storage.interface';
import { PROVIDER_ARCHIVE_STORAGE } from './interfaces/provider-archive-storage.interface';
import { REFRESH_TOKEN_STORAGE } from './interfaces/refresh-token-storage.interface';
import { REGISTRATION_ENTRY_STORAGE } from './interfaces/registration-entry-storage.interface';
import { BOLT_HISTORY_STORAGE } from './interfaces/bolt-history.interface';
import { CHAT_STORAGE } from './interfaces/chat-storage.interface';
import { TOURNAMENT_STORAGE } from './interfaces/tournament-storage.interface';
import { ASSIGNMENT_STORAGE } from './interfaces/assignment-storage.interface';
import { AUTH_CODE_STORAGE } from './interfaces/auth-code-storage.interface';
import { PROVIDER_STORAGE } from './interfaces/provider-storage.interface';
import { TOPOLOGY_STORAGE } from './interfaces/topology-storage.interface';
import { PROVIDER_CATALOG_STORAGE } from './interfaces/provider-catalog-storage.interface';
import { CALENDAR_STORAGE } from './interfaces/calendar-storage.interface';
import { POLICY_STORAGE } from './interfaces/policy-storage.interface';
import { AUDIT_STORAGE } from './interfaces/audit-storage.interface';
import { USER_STORAGE } from './interfaces/user-storage.interface';

import { PostgresBoltHistoryReportingStorage } from './postgres/postgres-bolt-history-reporting.storage';
import { PostgresProvisionerProviderStorage } from './postgres/postgres-provisioner-provider.storage';
import { PostgresTournamentProvisionerStorage } from './postgres/postgres-tournament-provisioner.storage';
import { PostgresProvisionerApiKeyStorage } from './postgres/postgres-provisioner-api-key.storage';
import { PostgresProviderApiKeyStorage } from './postgres/postgres-provider-api-key.storage';
import { PostgresUserProviderStorage } from './postgres/postgres-user-provider.storage';
import { PostgresProvisionerStorage } from './postgres/postgres-provisioner.storage';
import { PostgresSsoIdentityStorage } from './postgres/postgres-sso-identity.storage';
import { PostgresUserProvisionerStorage } from './postgres/postgres-user-provisioner.storage';
import { PostgresProviderArchiveStorage } from './postgres/postgres-provider-archive.storage';
import { PostgresRefreshTokenStorage } from './postgres/postgres-refresh-token.storage';
import { PostgresRegistrationEntryStorage } from './postgres/postgres-registration-entry.storage';
import { PostgresAuditStorage } from './postgres/postgres-audit.storage';
import { PostgresBoltHistoryStorage } from './postgres/postgres-bolt-history.storage';
import { PostgresChatStorage } from './postgres/postgres-chat.storage';
import { PostgresTournamentStorage } from './postgres/postgres-tournament.storage';
import { PostgresAssignmentStorage } from './postgres/postgres-assignment.storage';
import { PostgresProviderStorage } from './postgres/postgres-provider.storage';
import { PostgresTopologyStorage } from './postgres/postgres-topology.storage';
import { PostgresProviderCatalogStorage } from './postgres/postgres-provider-catalog.storage';
import { PostgresCalendarStorage } from './postgres/postgres-calendar.storage';
import { PostgresAuthCodeStorage } from './postgres/postgres-auth-code.storage';
import { PostgresPolicyStorage } from './postgres/postgres-policy.storage';
import { PostgresUserStorage } from './postgres/postgres-user.storage';
import { MigrationRunnerService } from './postgres/migration-runner.service';
import { PG_POOL, getPostgresConfig } from './postgres/postgres.config';

import { TournamentStorageService } from './tournament-storage.service';
import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

const pgPoolProvider = {
  provide: PG_POOL,
  useFactory: () => new Pool(getPostgresConfig()),
};

// Nest only invokes onModuleDestroy on class-provider instances, not on
// values returned from a useFactory. This sibling provider holds the pool
// and ends it on app.close() so Jest workers don't force-exit on idle sockets.
@Injectable()
class PgPoolLifecycle implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

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
const topologyStorageProvider = makeStorageProvider(TOPOLOGY_STORAGE, PostgresTopologyStorage);
const providerCatalogStorageProvider = makeStorageProvider(
  PROVIDER_CATALOG_STORAGE,
  PostgresProviderCatalogStorage,
);
const calendarStorageProvider = makeStorageProvider(CALENDAR_STORAGE, PostgresCalendarStorage);
const authCodeStorageProvider = makeStorageProvider(AUTH_CODE_STORAGE, PostgresAuthCodeStorage);
const boltHistoryStorageProvider = makeStorageProvider(BOLT_HISTORY_STORAGE, PostgresBoltHistoryStorage);
const boltHistoryReportingProvider = makeStorageProvider(BOLT_HISTORY_REPORTING, PostgresBoltHistoryReportingStorage);
const userProviderStorageProvider = makeStorageProvider(USER_PROVIDER_STORAGE, PostgresUserProviderStorage);
const assignmentStorageProvider = makeStorageProvider(ASSIGNMENT_STORAGE, PostgresAssignmentStorage);
const auditStorageProvider = makeStorageProvider(AUDIT_STORAGE, PostgresAuditStorage);
const provisionerStorageProvider = makeStorageProvider(PROVISIONER_STORAGE, PostgresProvisionerStorage);
const provisionerApiKeyStorageProvider = makeStorageProvider(PROVISIONER_API_KEY_STORAGE, PostgresProvisionerApiKeyStorage);
const providerApiKeyStorageProvider = makeStorageProvider(PROVIDER_API_KEY_STORAGE, PostgresProviderApiKeyStorage);
const provisionerProviderStorageProvider = makeStorageProvider(PROVISIONER_PROVIDER_STORAGE, PostgresProvisionerProviderStorage);
const tournamentProvisionerStorageProvider = makeStorageProvider(TOURNAMENT_PROVISIONER_STORAGE, PostgresTournamentProvisionerStorage);
const ssoIdentityStorageProvider = makeStorageProvider(SSO_IDENTITY_STORAGE, PostgresSsoIdentityStorage);
const userProvisionerStorageProvider = makeStorageProvider(USER_PROVISIONER_STORAGE, PostgresUserProvisionerStorage);
const providerArchiveStorageProvider = makeStorageProvider(PROVIDER_ARCHIVE_STORAGE, PostgresProviderArchiveStorage);
const policyStorageProvider = makeStorageProvider(POLICY_STORAGE, PostgresPolicyStorage);
const refreshTokenStorageProvider = makeStorageProvider(REFRESH_TOKEN_STORAGE, PostgresRefreshTokenStorage);
const registrationEntryStorageProvider = makeStorageProvider(REGISTRATION_ENTRY_STORAGE, PostgresRegistrationEntryStorage);
const chatStorageProvider = makeStorageProvider(CHAT_STORAGE, PostgresChatStorage);

@Global()
@Module({
  providers: [
    pgPoolProvider,
    PgPoolLifecycle,
    MigrationRunnerService,
    tournamentStorageProvider,
    userStorageProvider,
    providerStorageProvider,
    topologyStorageProvider,
    providerCatalogStorageProvider,
    calendarStorageProvider,
    authCodeStorageProvider,
    boltHistoryStorageProvider,
    boltHistoryReportingProvider,
    userProviderStorageProvider,
    assignmentStorageProvider,
    auditStorageProvider,
    provisionerStorageProvider,
    provisionerApiKeyStorageProvider,
    providerApiKeyStorageProvider,
    provisionerProviderStorageProvider,
    tournamentProvisionerStorageProvider,
    ssoIdentityStorageProvider,
    userProvisionerStorageProvider,
    providerArchiveStorageProvider,
    policyStorageProvider,
    refreshTokenStorageProvider,
    registrationEntryStorageProvider,
    chatStorageProvider,
    TournamentStorageService,
  ],
  exports: [
    PG_POOL,
    TOURNAMENT_STORAGE,
    USER_STORAGE,
    PROVIDER_STORAGE,
    TOPOLOGY_STORAGE,
    PROVIDER_CATALOG_STORAGE,
    CALENDAR_STORAGE,
    AUTH_CODE_STORAGE,
    BOLT_HISTORY_STORAGE,
    BOLT_HISTORY_REPORTING,
    USER_PROVIDER_STORAGE,
    ASSIGNMENT_STORAGE,
    AUDIT_STORAGE,
    PROVISIONER_STORAGE,
    PROVISIONER_API_KEY_STORAGE,
    PROVIDER_API_KEY_STORAGE,
    PROVISIONER_PROVIDER_STORAGE,
    TOURNAMENT_PROVISIONER_STORAGE,
    SSO_IDENTITY_STORAGE,
    USER_PROVISIONER_STORAGE,
    PROVIDER_ARCHIVE_STORAGE,
    POLICY_STORAGE,
    REFRESH_TOKEN_STORAGE,
    REGISTRATION_ENTRY_STORAGE,
    CHAT_STORAGE,
    TournamentStorageService,
  ],
})
export class StorageModule {}
