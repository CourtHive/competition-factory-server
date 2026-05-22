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

export async function confirmEmail(emailConfirmationId) {
  return baseApi.get(`/auth/confirm/${emailConfirmationId}`);
}

export async function forgotPassword(email) {
  return baseApi.post('/auth/forgot-password', { email });
}

export async function resetPassword(email, password, code) {
  return baseApi.post('/auth/reset-password', { email, password, code });
}

export async function ssoLoginWithToken(token: string) {
  return baseApi.post('/auth/sso/login-with-token', { token });
}
