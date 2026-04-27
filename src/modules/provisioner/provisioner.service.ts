import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';

import { computeEffectiveConfig } from '../providers/effective-provider-config';
import { validateCaps, validateSettings } from '../providers/provider-config.validator';
import { AuditService } from '../audit/audit.service';

import {
  PROVISIONER_STORAGE,
  type IProvisionerStorage,
  PROVISIONER_API_KEY_STORAGE,
  type IProvisionerApiKeyStorage,
  PROVISIONER_PROVIDER_STORAGE,
  type IProvisionerProviderStorage,
  PROVIDER_STORAGE,
  type IProviderStorage,
  SSO_IDENTITY_STORAGE,
  type ISsoIdentityStorage,
  USER_STORAGE,
  type IUserStorage,
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  USER_PROVISIONER_STORAGE,
  type IUserProvisionerStorage,
  ASSIGNMENT_STORAGE,
  type IAssignmentStorage,
  TOURNAMENT_PROVISIONER_STORAGE,
  type ITournamentProvisionerStorage,
} from 'src/storage/interfaces';
import { PROVISIONER as PROVISIONER_ROLE } from 'src/common/constants/roles';

const PROV_KEY_PREFIX = 'prov_sk_live_';

@Injectable()
export class ProvisionerService {
  constructor(
    @Inject(PROVISIONER_STORAGE) private readonly provisionerStorage: IProvisionerStorage,
    @Inject(PROVISIONER_API_KEY_STORAGE) private readonly apiKeyStorage: IProvisionerApiKeyStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE) private readonly providerAssocStorage: IProvisionerProviderStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(SSO_IDENTITY_STORAGE) private readonly ssoIdentityStorage: ISsoIdentityStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(ASSIGNMENT_STORAGE) private readonly assignmentStorage: IAssignmentStorage,
    @Inject(TOURNAMENT_PROVISIONER_STORAGE) private readonly tournamentProvisionerStorage: ITournamentProvisionerStorage,
    @Inject(USER_PROVISIONER_STORAGE) private readonly userProvisionerStorage: IUserProvisionerStorage,
    private readonly auditService: AuditService,
  ) {}

  // ── User ↔ Provisioner association (Phase 2A) ──

  async listProvisionerRepresentatives(provisionerId: string) {
    const associations = await this.userProvisionerStorage.findUsersByProvisioner(provisionerId);
    if (associations.length === 0) return { success: true, users: [] };

    // Hydrate user details (email, name) for each association. Iterate
    // sequentially since IUserStorage.findOne is keyed by email and we have
    // userIds — fall back to a per-association direct lookup.
    const users: any[] = [];
    for (const assoc of associations) {
      // userStorage doesn't expose a findById helper. We accept a lean
      // representation here (userId + grantedBy + createdAt). The admin UI
      // can join against the existing user list for display details.
      users.push(assoc);
    }
    return { success: true, users };
  }

  async assignUserToProvisioner(provisionerId: string, userEmail: string, grantedBy?: string) {
    const provisioner = await this.provisionerStorage.getProvisioner(provisionerId);
    if (!provisioner) return { error: 'Provisioner not found', code: 'PROVISIONER_NOT_FOUND' };

    const user = await this.userStorage.findOne(userEmail);
    if (!user) return { error: 'User not found', code: 'USER_NOT_FOUND' };
    if (!user.userId) return { error: 'User has no userId', code: 'USER_MISSING_ID' };

    // Idempotently grant the PROVISIONER global role
    const roles: string[] = Array.isArray(user.roles) ? [...user.roles] : [];
    if (!roles.includes(PROVISIONER_ROLE)) {
      roles.push(PROVISIONER_ROLE);
      await this.userStorage.update(userEmail, { ...user, roles });
    }

    await this.userProvisionerStorage.associate(user.userId, provisionerId, grantedBy);

    return {
      success: true,
      association: {
        userId: user.userId,
        email: user.email,
        provisionerId,
      },
    };
  }

  async removeUserFromProvisioner(provisionerId: string, userId: string) {
    await this.userProvisionerStorage.disassociate(userId, provisionerId);

    // Strip the PROVISIONER role if this was the user's only provisioner
    // association — without it, the global role becomes meaningless and would
    // dangle in the JWT. Look up the user by userId via the remaining
    // associations and find their email through the user storage.
    const remaining = await this.userProvisionerStorage.findProvisionerIdsByUser(userId);
    if (remaining.length === 0) {
      // Find the user record so we can update roles. We need email since
      // userStorage.update is email-keyed. Best-effort: skip if we can't
      // resolve email from userId (the role will simply have no effect).
      try {
        const all = await this.userStorage.findAll();
        const u = all.users?.find((x: any) => x.userId === userId);
        if (u?.email && Array.isArray(u.roles) && u.roles.includes(PROVISIONER_ROLE)) {
          const roles = u.roles.filter((r: string) => r !== PROVISIONER_ROLE);
          await this.userStorage.update(u.email, { ...u, roles });
        }
      } catch {
        // non-fatal — role left in place
      }
    }

    return { success: true };
  }

  // ── Provisioner CRUD (SUPER_ADMIN) ──

  async createProvisioner(params: { name: string; config?: Record<string, any> }) {
    const existing = await this.provisionerStorage.findByName(params.name);
    if (existing) return { error: 'Provisioner name already exists' };

    const provisioner = await this.provisionerStorage.create({
      name: params.name,
      isActive: true,
      config: params.config ?? {},
    });
    return { success: true, provisioner };
  }

  async listProvisioners() {
    const provisioners = await this.provisionerStorage.findAll();
    return { success: true, provisioners };
  }

  async getProvisioner(provisionerId: string) {
    const provisioner = await this.provisionerStorage.getProvisioner(provisionerId);
    if (!provisioner) return { error: 'Provisioner not found' };
    return { success: true, provisioner };
  }

  async updateProvisioner(provisionerId: string, data: { name?: string; isActive?: boolean; config?: Record<string, any> }) {
    return this.provisionerStorage.update(provisionerId, data);
  }

  async deactivateProvisioner(provisionerId: string) {
    return this.provisionerStorage.deactivate(provisionerId);
  }

  /**
   * Hard-delete a provisioner with cascade. Refuses to delete an active
   * provisioner — must be deactivated first (two-step safeguard).
   * Cascade rules: API keys, provisioner_provider associations, and
   * tournament_provisioner ownership stamps are removed. The providers
   * themselves and their tournaments are NOT deleted (they're independent
   * entities, possibly jointly managed).
   */
  async deleteProvisioner(
    provisionerId: string,
    actor?: { userId?: string; userEmail?: string },
  ) {
    const provisioner = await this.provisionerStorage.getProvisioner(provisionerId);
    if (!provisioner) return { error: 'Provisioner not found', code: 'PROVISIONER_NOT_FOUND' };
    if (provisioner.isActive) {
      return {
        error: 'Provisioner must be deactivated before deletion',
        code: 'PROVISIONER_STILL_ACTIVE',
      };
    }

    const cascadeCounts = await this.provisionerStorage.deleteWithCascade(provisionerId);

    await this.auditService.recordProvisionerDeletion({
      provisionerId,
      provisionerName: provisioner.name,
      cascadeCounts,
      userId: actor?.userId,
      userEmail: actor?.userEmail,
    });

    return { success: true, cascadeCounts };
  }

  // ── API Key management (SUPER_ADMIN) ──

  async generateApiKey(provisionerId: string, label?: string) {
    const provisioner = await this.provisionerStorage.getProvisioner(provisionerId);
    if (!provisioner) return { error: 'Provisioner not found' };

    // Generate a cryptographically random API key
    const rawKey = PROV_KEY_PREFIX + randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const keyRow = await this.apiKeyStorage.create({
      provisionerId,
      apiKeyHash: keyHash,
      label,
      isActive: true,
    });

    // Return plaintext key ONCE — it's never stored or retrievable again
    return { success: true, keyId: keyRow.keyId, apiKey: rawKey, label: keyRow.label };
  }

  async listApiKeys(provisionerId: string) {
    const keys = await this.apiKeyStorage.listByProvisioner(provisionerId);
    // Strip hashes from response — return metadata only
    return {
      success: true,
      keys: keys.map((k) => ({
        keyId: k.keyId,
        provisionerId: k.provisionerId,
        label: k.label,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      })),
    };
  }

  async revokeApiKey(keyId: string) {
    return this.apiKeyStorage.revoke(keyId);
  }

  // ── Provider association (SUPER_ADMIN + Provisioner) ──

  async associateProvider(provisionerId: string, providerId: string, relationship: 'owner' | 'subsidiary', grantedBy?: string) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found' };

    return this.providerAssocStorage.associate(provisionerId, providerId, relationship, grantedBy);
  }

  async disassociateProvider(provisionerId: string, providerId: string) {
    return this.providerAssocStorage.disassociate(provisionerId, providerId);
  }

  // ── Provider CRUD (Provisioner) ──

  async createProvider(
    provisionerId: string,
    params: {
      organisationAbbreviation: string;
      organisationName: string;
      // New two-tier shape (preferred)
      providerConfigCaps?: Record<string, any>;
      providerConfigSettings?: Record<string, any>;
      // Legacy single-blob shape (back-compat — treated as caps)
      providerConfig?: Record<string, any>;
    },
  ) {
    // Check abbreviation uniqueness
    const existing = await this.providerStorage.getProviders();
    const conflict = existing.find((p) => p.value?.organisationAbbreviation === params.organisationAbbreviation);
    if (conflict) return { error: 'organisationAbbreviation already exists', code: 'ABBREVIATION_EXISTS' };

    // Generate provider ID
    const providerId = crypto.randomUUID();

    // Resolve caps from explicit field or legacy `providerConfig` blob
    const providerConfigCaps = params.providerConfigCaps ?? params.providerConfig ?? {};
    const providerConfigSettings = params.providerConfigSettings ?? {};

    await this.providerStorage.setProvider(providerId, {
      organisationId: providerId,
      organisationAbbreviation: params.organisationAbbreviation,
      organisationName: params.organisationName,
      providerConfigCaps,
      providerConfigSettings,
    });

    // Auto-associate as owner
    await this.providerAssocStorage.associate(provisionerId, providerId, 'owner');

    return { success: true, providerId, organisationAbbreviation: params.organisationAbbreviation };
  }

  async listProviders(provisionerId: string) {
    const allProviders = await this.providerStorage.getProviders();
    const associations = await this.providerAssocStorage.findByProvisioner(provisionerId);
    const assocMap = new Map(associations.map((a) => [a.providerId, a.relationship]));

    const providers = allProviders.map((p) => {
      const relationship = assocMap.get(p.key) ?? null;
      const managed = relationship !== null;
      return {
        providerId: p.key,
        organisationAbbreviation: p.value?.organisationAbbreviation,
        organisationName: p.value?.organisationName,
        managed,
        relationship,
        ...(managed
          ? {
              providerConfigCaps: p.value?.providerConfigCaps ?? {},
              providerConfigSettings: p.value?.providerConfigSettings ?? {},
            }
          : {}),
        inactive: p.value?.inactive ?? false,
      };
    });

    return { providers };
  }

  async getProviderDetail(provisionerId: string, providerId: string) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' };

    const relationship = await this.providerAssocStorage.getRelationship(provisionerId, providerId);
    const managed = relationship !== null;

    return {
      providerId: provider.organisationId ?? providerId,
      organisationAbbreviation: provider.organisationAbbreviation,
      organisationName: provider.organisationName,
      managed,
      relationship,
      ...(managed
        ? {
            providerConfigCaps: provider.providerConfigCaps ?? {},
            providerConfigSettings: provider.providerConfigSettings ?? {},
          }
        : {}),
      inactive: provider.inactive ?? false,
    };
  }

  /**
   * Generic provider-record update (provisioner-level). Caps and settings
   * have their own dedicated endpoints (`updateProviderCaps`,
   * `updateProviderSettings`) with cap-respecting validation; this method
   * is for the lightweight name/inactive flag updates.
   *
   * Accepts a legacy `providerConfig` field for back-compat — when present,
   * it is written to `providerConfigCaps` (the legacy single blob always
   * represented provisioner-controlled config). Prefer the dedicated
   * caps-write endpoint for new callers.
   */
  async updateProviderConfig(
    providerId: string,
    params: {
      providerConfig?: Record<string, any>;
      providerConfigCaps?: Record<string, any>;
      providerConfigSettings?: Record<string, any>;
      organisationName?: string;
      inactive?: boolean;
    },
  ) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' };

    const updated = { ...provider };
    const capsUpdate = params.providerConfigCaps ?? params.providerConfig;
    if (capsUpdate !== undefined) updated.providerConfigCaps = capsUpdate;
    if (params.providerConfigSettings !== undefined) updated.providerConfigSettings = params.providerConfigSettings;
    if (params.organisationName !== undefined) updated.organisationName = params.organisationName;
    if (params.inactive !== undefined) updated.inactive = params.inactive;

    return this.providerStorage.setProvider(providerId, updated);
  }

  /**
   * Provisioner-side caps write — replaces the entire caps blob with
   * the validated input. Settings are untouched. Use this in preference
   * to the legacy `updateProviderConfig` for new caps writes.
   */
  async updateProviderCaps(providerId: string, caps: Record<string, any>) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' };
    const issues = validateCaps(caps);
    if (issues.length) return { error: 'caps validation failed', code: 'CAPS_INVALID', issues };
    return this.providerStorage.updateProviderCaps(providerId, caps);
  }

  /**
   * Provider-admin-side settings write — replaces the entire settings
   * blob with validated input. Caps are untouched. Settings must respect
   * caps (no booleans above ceiling, no allowedX outside cap universe);
   * violations are returned as `issues` with per-field detail.
   */
  async updateProviderSettings(providerId: string, settings: Record<string, any>) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' };
    const issues = validateSettings(settings, provider.providerConfigCaps ?? {});
    if (issues.length) return { error: 'settings validation failed', code: 'SETTINGS_INVALID', issues };
    return this.providerStorage.updateProviderSettings(providerId, settings);
  }

  /**
   * Compute the effective ProviderConfigData (caps ∩ settings) for a
   * single provider. Used by the GET /provider/:id/effective-config
   * endpoint and by AuthService at login.
   */
  async getEffectiveProviderConfig(providerId: string) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' };
    const effective = computeEffectiveConfig(
      provider.providerConfigCaps,
      provider.providerConfigSettings,
    );
    return { success: true, providerId, effective };
  }

  // ── SSO User management (Provisioner) ──

  async createSsoUser(provisionerId: string, params: {
    providerId: string;
    externalId: string;
    email: string;
    phone?: string;
    providerRole: string;
    ssoProvider: string;
  }) {
    // Check provider is managed
    const relationship = await this.providerAssocStorage.getRelationship(provisionerId, params.providerId);
    if (!relationship) return { error: 'Provider not managed by this provisioner', code: 'PROVIDER_NOT_MANAGED' };

    // Check for existing SSO identity
    const existingSso = await this.ssoIdentityStorage.findByExternalId(params.ssoProvider, params.externalId);
    if (existingSso) return { error: 'SSO identity already exists for this provider', code: 'SSO_IDENTITY_EXISTS' };

    // Check for existing email
    const existingUser = await this.userStorage.findOne(params.email);
    if (existingUser) return { error: 'Email already registered', code: 'EMAIL_EXISTS' };

    // Create user with no password (SSO-only)
    const createResult = await this.userStorage.create({
      email: params.email,
      password: '',  // SSO-only users have no password
    });
    if (!createResult) return { error: 'Failed to create user' };

    // Get the created user to retrieve userId
    const user = await this.userStorage.findOne(params.email);
    const userId = user?.userId ?? user?.user_id;
    if (!userId) return { error: 'User created but userId not found' };

    // Create SSO identity mapping
    await this.ssoIdentityStorage.create({
      userId,
      ssoProvider: params.ssoProvider,
      externalId: params.externalId,
      phone: params.phone,
      email: params.email,
    });

    // Associate user with provider
    await this.userProviderStorage.upsert({
      userId,
      providerId: params.providerId,
      providerRole: params.providerRole,
    });

    return {
      success: true,
      userId,
      email: params.email,
      providerRole: params.providerRole,
      providerId: params.providerId,
    };
  }

  async listProviderUsers(provisionerId: string, providerId: string) {
    const relationship = await this.providerAssocStorage.getRelationship(provisionerId, providerId);
    if (!relationship) return { error: 'Provider not managed by this provisioner', code: 'PROVIDER_NOT_MANAGED' };

    const userProviders = await this.userProviderStorage.findByProviderId(providerId);

    const users = await Promise.all(
      userProviders.map(async (up) => {
        const ssoIdentities = await this.ssoIdentityStorage.findByUserId(up.userId);
        const sso = ssoIdentities[0]; // Primary SSO identity
        return {
          userId: up.userId,
          email: up.email,
          providerRole: up.providerRole,
          ssoProvider: sso?.ssoProvider,
          externalId: sso?.externalId,
        };
      }),
    );

    return { users };
  }

  // ── Subsidiary management (Provisioner owner) ──

  async grantSubsidiary(ownerProvisionerId: string, providerId: string, targetProvisionerId: string) {
    const target = await this.provisionerStorage.getProvisioner(targetProvisionerId);
    if (!target) return { error: 'Target provisioner not found' };

    return this.providerAssocStorage.associate(targetProvisionerId, providerId, 'subsidiary', ownerProvisionerId);
  }

  async revokeSubsidiary(providerId: string, targetProvisionerId: string) {
    return this.providerAssocStorage.disassociate(targetProvisionerId, providerId);
  }

  async listSubsidiaries(providerId: string) {
    const associations = await this.providerAssocStorage.findByProvider(providerId);
    const subsidiaries = associations
      .filter((a) => a.relationship === 'subsidiary')
      .map((a) => ({
        provisionerId: a.provisionerId,
        grantedAt: a.createdAt,
      }));

    // Enrich with provisioner names
    const enriched = await Promise.all(
      subsidiaries.map(async (s) => {
        const prov = await this.provisionerStorage.getProvisioner(s.provisionerId);
        return { ...s, name: prov?.name ?? 'unknown' };
      }),
    );

    return { subsidiaries: enriched };
  }

  // ── Tournament assignments (Provisioner) ──

  async grantAssignment(provisionerId: string, params: {
    tournamentId: string;
    userEmail: string;
    providerId: string;
    role?: string;
  }) {
    const { tournamentId, userEmail, providerId, role } = params;

    // Verify provisioner manages this provider
    const relationship = await this.providerAssocStorage.getRelationship(provisionerId, providerId);
    if (!relationship) return { error: 'Provider not managed by this provisioner', code: 'PROVIDER_NOT_MANAGED' };

    // Subsidiary check: can only assign to own tournaments
    if (relationship === 'subsidiary') {
      const ownership = await this.tournamentProvisionerStorage.getByTournament(tournamentId);
      if (ownership?.provisionerId !== provisionerId) {
        return { error: 'Subsidiary provisioners can only assign users to their own tournaments', code: 'TOURNAMENT_NOT_OWNED' };
      }
    }

    // Resolve user
    const user = await this.userStorage.findOne(userEmail);
    if (!user) return { error: 'User not found', code: 'USER_NOT_FOUND' };
    const userId = user.userId ?? user.user_id;
    if (!userId) return { error: 'User has no UUID' };

    // Verify user is associated with the provider
    const association = await this.userProviderStorage.findOne(userId, providerId);
    if (!association) return { error: 'User is not associated with this provider', code: 'USER_NOT_IN_PROVIDER' };

    const row = {
      tournamentId,
      userId,
      providerId,
      assignmentRole: role || 'DIRECTOR',
      grantedBy: null as any, // provisioner-originated: no user grantor
    };

    await this.assignmentStorage.grant(row);
    return { success: true, assignment: { ...row, email: userEmail } };
  }

  async revokeAssignment(provisionerId: string, params: {
    tournamentId: string;
    userEmail: string;
    providerId: string;
  }) {
    const { tournamentId, userEmail, providerId } = params;

    const relationship = await this.providerAssocStorage.getRelationship(provisionerId, providerId);
    if (!relationship) return { error: 'Provider not managed by this provisioner', code: 'PROVIDER_NOT_MANAGED' };

    if (relationship === 'subsidiary') {
      const ownership = await this.tournamentProvisionerStorage.getByTournament(tournamentId);
      if (ownership?.provisionerId !== provisionerId) {
        return { error: 'Subsidiary provisioners can only manage their own tournaments', code: 'TOURNAMENT_NOT_OWNED' };
      }
    }

    const user = await this.userStorage.findOne(userEmail);
    if (!user) return { error: 'User not found', code: 'USER_NOT_FOUND' };
    const userId = user.userId ?? user.user_id;

    await this.assignmentStorage.revoke(tournamentId, userId);
    return { success: true };
  }

  async listAssignments(provisionerId: string, params: { tournamentId?: string; providerId: string }) {
    const { tournamentId, providerId } = params;

    const relationship = await this.providerAssocStorage.getRelationship(provisionerId, providerId);
    if (!relationship) return { error: 'Provider not managed by this provisioner', code: 'PROVIDER_NOT_MANAGED' };

    if (tournamentId) {
      const assignments = await this.assignmentStorage.findByTournamentId(tournamentId);
      return { success: true, assignments };
    }

    return { success: true, assignments: [] };
  }
}
