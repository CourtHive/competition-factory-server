import { baseApi } from '../apis/baseApi';

export async function systemLogin(email, password) {
  return baseApi.post('/auth/login', {
    password,
    email,
  });
}

export async function adminCreateUser(payload: {
  email: string;
  password?: string;
  providerId?: string;
  providerRole?: 'PROVIDER_ADMIN' | 'DIRECTOR';
  firstName?: string;
  lastName?: string;
  phone?: string;
  roles?: string[];
  permissions?: string[];
  services?: string[];
}) {
  return baseApi.post('/auth/admin-create-user', payload);
}

export async function completeFirstLogin(limitedToken: string, newPassword: string) {
  return baseApi.post('/auth/complete-first-login', { limitedToken, newPassword });
}

export async function setContactEmail(contactEmail: string) {
  return baseApi.post('/account/contact-email/set', { contactEmail });
}

export async function resendVerification() {
  return baseApi.post('/account/contact-email/resend-verification', {});
}

export async function verifyEmail(token: string) {
  return baseApi.post('/auth/verify-email', { token });
}

export async function getMe() {
  return baseApi.get('/auth/me');
}

export async function confirmEmail(emailConfirmationId) {
  return baseApi.get(`/auth/confirm/${emailConfirmationId}`);
}

/**
 * Request a password reset. Server is enumeration-defensive — always
 * returns `{ ok: true }`, never confirms registration.
 */
export async function forgotPassword(contactEmail: string) {
  return baseApi.post('/auth/forgot-password', { contactEmail });
}

/**
 * Apply a password reset using the JWT from the email link. Server
 * verifies the token (purpose: 'password-reset', 1h expiry) and writes
 * the new password atomically.
 */
export async function resetPassword(token: string, newPassword: string) {
  return baseApi.post('/auth/reset-password', { token, newPassword });
}

export async function ssoLoginWithToken(token: string) {
  return baseApi.post('/auth/sso/login-with-token', { token });
}
