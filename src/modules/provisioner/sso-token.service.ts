import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createClient } from 'redis';

const SSO_TOKEN_PREFIX = 'sso:token:';
const SSO_TOKEN_TTL_SECONDS = 60;

export interface SsoTokenPayload {
  externalId: string;
  ssoProvider: string;
  providerId: string;
  provisionerId: string;
}

/**
 * Manages one-time SSO tokens in Redis with atomic consumption.
 *
 * Uses the raw Redis client (not cache-manager) to support GETDEL —
 * an atomic get-and-delete that prevents token replay attacks.
 * Tokens expire after 60 seconds regardless of consumption.
 */
@Injectable()
export class SsoTokenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SsoTokenService.name);
  private client: ReturnType<typeof createClient> | null = null;

  async onModuleInit() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.client = createClient({
        url,
        socket: {
          connectTimeout: 2000,
          // node-redis defaults to retrying initial connect forever with a
          // 50ms linear backoff, which silently hangs nest boot when Redis
          // is down (await client.connect() never resolves, the catch
          // below never runs). Bound to ~3 attempts so connect() rejects
          // and the catch handler can mark the service unavailable.
          reconnectStrategy: (retries) => {
            if (retries >= 3) return new Error('Redis unreachable');
            return Math.min(retries * 200, 1000);
          },
        },
      });
      this.client.on('error', (err) => this.logger.warn(`Redis client error: ${err.message}`));
      await this.client.connect();
      this.logger.log('SSO token Redis client connected');
    } catch (err: any) {
      this.logger.warn(`SSO token Redis client failed to connect: ${err.message}. SSO tokens will be unavailable.`);
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  /** Generate a one-time SSO token. Returns the token string. */
  async generate(payload: SsoTokenPayload): Promise<{ token: string; expiresIn: number }> {
    if (!this.client) throw new Error('Redis not available for SSO tokens');

    const token = randomUUID();
    const key = SSO_TOKEN_PREFIX + token;

    await this.client.set(key, JSON.stringify(payload), { EX: SSO_TOKEN_TTL_SECONDS });

    return { token, expiresIn: SSO_TOKEN_TTL_SECONDS };
  }

  /**
   * Consume a one-time SSO token. Returns the payload if valid,
   * null if expired or already consumed. Uses GETDEL for atomicity.
   */
  async consume(token: string): Promise<SsoTokenPayload | null> {
    if (!this.client) throw new Error('Redis not available for SSO tokens');

    const key = SSO_TOKEN_PREFIX + token;
    const raw = await this.client.getDel(key);

    if (!raw) return null;

    try {
      return JSON.parse(raw) as SsoTokenPayload;
    } catch {
      this.logger.error(`Corrupt SSO token payload for ${token}`);
      return null;
    }
  }
}
