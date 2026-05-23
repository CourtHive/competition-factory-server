import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  PROVIDER_API_KEY_STORAGE,
  type IProviderApiKeyStorage,
} from 'src/storage/interfaces';
import { CLIENT, GENERATE, SCORE } from 'src/common/constants/roles';
import type { UserContext } from '../account/auth/decorators/user-context.decorator';

const PKEY_PREFIX = 'pkey_';

/**
 * Middleware that authenticates provider API key requests.
 *
 * Distinct from ProvisionerMiddleware (which handles `prov_` tokens):
 * - Only matches `pkey_*` Bearer tokens.
 * - Scope is implicit: the key names a single provider; there is no
 *   `X-Provider-Id` header involvement.
 *
 * If matched:
 * 1. Hashes the key (SHA-256) and looks it up via storage.
 * 2. Sets request.provider = { providerId, providerName, providerConfig, keyId, keyLabel }.
 * 3. Synthesizes request.user + request.userContext so downstream
 *    factory/save endpoints work unchanged — the key acts as a
 *    PROVIDER_ADMIN for its own provider.
 * 4. Sets request.auditSource so the audit trail can distinguish
 *    provider-key actions from JWT-user actions.
 *
 * AuthGuard then sees request.user and skips JWT verification.
 */
@Injectable()
export class ProviderApiKeyMiddleware implements NestMiddleware {
  constructor(
    @Inject(PROVIDER_API_KEY_STORAGE) private readonly apiKeyStorage: IProviderApiKeyStorage,
  ) {}

  async use(req: any, _res: any, next: () => void): Promise<void> {
    const authHeader: string | undefined = req.headers?.authorization;
    if (!authHeader) {
      next();
      return;
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token?.startsWith(PKEY_PREFIX)) {
      next();
      return;
    }

    const keyHash = hashApiKey(token);

    let keyResult: Awaited<ReturnType<IProviderApiKeyStorage['findByKeyHash']>>;
    try {
      keyResult = await this.apiKeyStorage.findByKeyHash(keyHash);
    } catch {
      // Storage unavailable — fall through; AuthGuard will 401
      next();
      return;
    }

    if (!keyResult) {
      // Invalid / revoked / expired key — fall through; AuthGuard will 401
      next();
      return;
    }

    const { key, providerName, providerConfig } = keyResult;

    req.provider = {
      providerId: key.providerId,
      providerName,
      providerConfig,
      keyId: key.keyId,
      keyLabel: key.label,
    };

    req.auditSource = {
      type: 'provider-key',
      providerId: key.providerId,
      keyId: key.keyId,
      keyLabel: key.label,
    };

    // Update last_used_at (fire-and-forget — don't block the request)
    this.apiKeyStorage.updateLastUsed(key.keyId).catch(() => {});

    // Synthesize a user context so downstream guards/services see the
    // provider key as a PROVIDER_ADMIN for its own provider. No
    // cross-provider visibility, no super-admin powers.
    req.user = {
      userId: `provider:${key.providerId}`,
      email: `key@${providerName ?? key.providerId}`,
      roles: [CLIENT, GENERATE, SCORE],
      providerId: key.providerId,
    };

    req.userContext = {
      userId: `provider:${key.providerId}`,
      email: `key@${providerName ?? key.providerId}`,
      isSuperAdmin: false,
      globalRoles: [CLIENT, GENERATE, SCORE],
      providerRoles: { [key.providerId]: 'PROVIDER_ADMIN' },
      providerIds: [key.providerId],
      provisionerProviderIds: [],
    } satisfies UserContext;

    next();
  }
}

/** SHA-256 hash of an API key for database lookup. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
