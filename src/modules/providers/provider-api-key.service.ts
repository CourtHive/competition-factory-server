import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

import {
  PROVIDER_API_KEY_STORAGE,
  type IProviderApiKeyStorage,
  PROVIDER_STORAGE,
  type IProviderStorage,
} from 'src/storage/interfaces';
import { AuditService } from '../audit/audit.service';

const PKEY_PREFIX = 'pkey_live_';

/**
 * Manage provider-scoped API keys (mint, list, revoke).
 *
 * Keys are minted as `pkey_live_<64 hex chars>` and stored only as a
 * SHA-256 hash. The plaintext is returned ONCE on creation and never
 * persisted. Mirrors the provisioner-key pattern, but scoped to a single
 * provider with no on-behalf-of indirection.
 */
@Injectable()
export class ProviderApiKeyService {
  private readonly logger = new Logger(ProviderApiKeyService.name);

  constructor(
    @Inject(PROVIDER_API_KEY_STORAGE) private readonly apiKeyStorage: IProviderApiKeyStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    private readonly auditService: AuditService,
  ) {}

  async generateApiKey(
    providerId: string,
    label: string | undefined,
    actor?: { userId?: string; userEmail?: string },
  ) {
    const provider: any = await this.providerStorage.getProvider(providerId);
    if (!provider) {
      throw new NotFoundException(`Provider ${providerId} not found`);
    }

    const rawKey = PKEY_PREFIX + randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const keyRow = await this.apiKeyStorage.create({
      providerId,
      apiKeyHash: keyHash,
      label,
      isActive: true,
    });

    // Audit (fail-soft) so key issuance is traceable from the audit_log
    // table alongside mutations. tournamentId is set to the providerId as
    // a denormalized stable scope key for queryability.
    this.auditService
      .recordMutation({
        tournamentIds: [providerId],
        userId: actor?.userId,
        userEmail: actor?.userEmail,
        source: 'admin',
        methods: [{ method: 'generateProviderApiKey', params: { providerId, label, keyId: keyRow.keyId } }],
        status: 'applied',
        metadata: { providerId, keyId: keyRow.keyId, label },
      })
      .catch((err) => this.logger.error(`Audit failed for generateProviderApiKey: ${err.message}`));

    return {
      success: true,
      keyId: keyRow.keyId,
      apiKey: rawKey,
      label: keyRow.label,
      createdAt: keyRow.createdAt,
    };
  }

  async listApiKeys(providerId: string) {
    const rows = await this.apiKeyStorage.listByProvider(providerId);
    // Strip the hash before returning — admin UI never needs it.
    const keys = rows.map((row) => ({
      keyId: row.keyId,
      label: row.label,
      isActive: row.isActive,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      prefix: PKEY_PREFIX,
    }));
    return { success: true, keys };
  }

  async revokeApiKey(
    keyId: string,
    actor?: { userId?: string; userEmail?: string },
    providerIdHint?: string,
  ) {
    const result = await this.apiKeyStorage.revoke(keyId);

    this.auditService
      .recordMutation({
        tournamentIds: providerIdHint ? [providerIdHint] : [keyId],
        userId: actor?.userId,
        userEmail: actor?.userEmail,
        source: 'admin',
        methods: [{ method: 'revokeProviderApiKey', params: { keyId } }],
        status: 'applied',
        metadata: { keyId, providerId: providerIdHint },
      })
      .catch((err) => this.logger.error(`Audit failed for revokeProviderApiKey: ${err.message}`));

    return result;
  }
}
