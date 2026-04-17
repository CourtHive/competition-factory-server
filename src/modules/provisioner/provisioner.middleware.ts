import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  PROVISIONER_API_KEY_STORAGE,
  type IProvisionerApiKeyStorage,
  PROVISIONER_PROVIDER_STORAGE,
  type IProvisionerProviderStorage,
} from 'src/storage/interfaces';
import { CLIENT, GENERATE, SCORE } from 'src/common/constants/roles';
import type { UserContext } from '../auth/decorators/user-context.decorator';

const PROV_PREFIX = 'prov_';

/**
 * Middleware that authenticates provisioner API key requests.
 *
 * Runs before AuthGuard. If it detects a `prov_*` Bearer token:
 * 1. Hashes the key (SHA-256) and looks it up via storage
 * 2. Validates the provisioner is active
 * 3. If X-Provider-Id header present, validates the relationship
 * 4. Sets request.provisioner, request.user (synthetic), request.userContext (synthetic)
 * 5. Sets request.auditSource for audit trail differentiation
 *
 * AuthGuard then sees request.provisioner and skips JWT verification.
 */
@Injectable()
export class ProvisionerMiddleware implements NestMiddleware {
  constructor(
    @Inject(PROVISIONER_API_KEY_STORAGE) private readonly apiKeyStorage: IProvisionerApiKeyStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE) private readonly providerStorage: IProvisionerProviderStorage,
  ) {}

  async use(req: any, _res: any, next: () => void): Promise<void> {
    const authHeader: string | undefined = req.headers?.authorization;
    if (!authHeader) {
      next();
      return;
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token?.startsWith(PROV_PREFIX)) {
      next();
      return;
    }

    // Hash the API key for lookup (SHA-256, not bcrypt — API keys need exact-match lookup)
    const keyHash = hashApiKey(token);

    let keyResult: Awaited<ReturnType<IProvisionerApiKeyStorage['findByKeyHash']>>;
    try {
      keyResult = await this.apiKeyStorage.findByKeyHash(keyHash);
    } catch {
      // Storage unavailable — fall through to AuthGuard which will 401
      next();
      return;
    }

    if (!keyResult) {
      // Invalid key — fall through to AuthGuard which will 401
      next();
      return;
    }

    const { key, provisionerName, provisionerConfig } = keyResult;

    // Set provisioner identity on the request
    req.provisioner = {
      provisionerId: key.provisionerId,
      name: provisionerName,
      config: provisionerConfig,
      keyId: key.keyId,
      keyLabel: key.label,
    };

    // Set audit source for provisioner actions
    req.auditSource = {
      type: 'provisioner',
      provisionerId: key.provisionerId,
      keyId: key.keyId,
      keyLabel: key.label,
    };

    // Update last_used_at (fire-and-forget, don't block the request)
    this.apiKeyStorage.updateLastUsed(key.keyId).catch(() => {});

    // Check for X-Provider-Id header (on-behalf-of / impersonation)
    const providerId: string | undefined = req.headers['x-provider-id'];
    if (providerId) {
      let relationship: 'owner' | 'subsidiary' | null = null;
      try {
        relationship = await this.providerStorage.getRelationship(key.provisionerId, providerId);
      } catch {
        // Storage error — don't set provider context
      }

      if (relationship) {
        req.provisionerRelationship = relationship;

        // Inject synthetic user context so downstream endpoints work unchanged
        req.user = {
          userId: `provisioner:${key.provisionerId}`,
          email: `provisioner@${provisionerName}`,
          roles: [CLIENT, GENERATE, SCORE],
          providerId,
        };

        req.userContext = {
          userId: `provisioner:${key.provisionerId}`,
          email: `provisioner@${provisionerName}`,
          isSuperAdmin: false,
          globalRoles: [CLIENT, GENERATE, SCORE],
          providerRoles: { [providerId]: 'PROVIDER_ADMIN' },
          providerIds: [providerId],
        } satisfies UserContext;
      }
    }

    next();
  }
}

/** SHA-256 hash of an API key for database lookup. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
