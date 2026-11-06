import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces/user-storage.interface';
import { TEST_EMAIL } from 'src/common/constants/test';
import { signJwt } from 'src/common/auth/signJwt';

/**
 * Sessions for the live-stack specs, now that CFS no longer logs anyone in.
 *
 * Login belongs to the identity provider (courthive-hiveid); CFS only VERIFIES its tokens. A hiveid session token is
 * the user's row (password removed) plus `aud` and the acting `providerId`. CFS reads both halves: `AuthGuard` makes
 * the CLAIMS `request.user` (so `RolesGuard` checks the token's `roles`), and `AuthMiddleware` loads the row and
 * provider roles by the token's `email`. So a spec needs a real `users` row and a token carrying that row's identity
 * claims, signed by the app's own `JwtService` (the same signer the SPLIT token routes use).
 */
export async function ensureUser(app: INestApplication, email: string, roles: string[]): Promise<void> {
  const users = app.get<IUserStorage>(USER_STORAGE);
  if (await users.findOne(email)) return;
  // No password: these accounts never log in, they are only the subject of a signed session.
  await users.create({ email, password: '', roles });
}

export async function signSessionToken(
  app: INestApplication,
  claims: { email: string; providerId?: string },
): Promise<string> {
  const user = await app.get<IUserStorage>(USER_STORAGE).findOne(claims.email);
  if (!user) throw new Error(`signSessionToken: no users row for ${claims.email}`);
  const { userId, roles, permissions } = user;
  const payload = { userId, roles, permissions, email: user.email, providerId: claims.providerId, aud: 'admin' };
  return signJwt(app.get(JwtService), payload, { expiresIn: '1h' });
}

/** A super-admin session for {@link TEST_EMAIL}, backed by a real `users` row. */
export async function superAdminToken(app: INestApplication): Promise<string> {
  await ensureUser(app, TEST_EMAIL, ['superadmin', 'admin', 'client']);
  return signSessionToken(app, { email: TEST_EMAIL });
}
