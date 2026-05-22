import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock('../apis/baseApi', () => ({
  baseApi: {
    post: (...args) => mockPost(...args),
    get: (...args) => mockGet(...args),
  },
}));

import {
  systemLogin,
  adminCreateUser,
  completeFirstLogin,
  confirmEmail,
  forgotPassword,
  resetPassword,
  ssoLoginWithToken,
} from './authApi';

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
});

describe('authApi', () => {
  describe('systemLogin', () => {
    it('posts to /auth/login with email and password', async () => {
      mockPost.mockResolvedValue({ data: { token: 'jwt-123' } });
      await systemLogin('user@test.com', 's3cret');
      expect(mockPost).toHaveBeenCalledWith('/auth/login', {
        email: 'user@test.com',
        password: 's3cret',
      });
    });
  });

  describe('adminCreateUser', () => {
    it('posts the full payload to /auth/admin-create-user', async () => {
      mockPost.mockResolvedValue({ data: { success: true, password: 'gen12345abcd' } });
      await adminCreateUser({
        email: 'new@test.com',
        providerId: 'org-1',
        providerRole: 'DIRECTOR',
        roles: ['client'],
        permissions: ['devMode'],
        services: ['tournamentProfile'],
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(mockPost).toHaveBeenCalledWith('/auth/admin-create-user', {
        email: 'new@test.com',
        providerId: 'org-1',
        providerRole: 'DIRECTOR',
        roles: ['client'],
        permissions: ['devMode'],
        services: ['tournamentProfile'],
        firstName: 'Jane',
        lastName: 'Doe',
      });
    });

    it('omits password when caller wants the server to generate one', async () => {
      mockPost.mockResolvedValue({ data: { success: true, password: 'auto12345abc' } });
      await adminCreateUser({ email: 'new@test.com', providerId: 'org-1' });
      expect(mockPost).toHaveBeenCalledWith('/auth/admin-create-user', {
        email: 'new@test.com',
        providerId: 'org-1',
      });
    });
  });

  describe('completeFirstLogin', () => {
    it('posts the limited token + new password to /auth/complete-first-login', async () => {
      mockPost.mockResolvedValue({ data: { token: 'jwt-full' } });
      await completeFirstLogin('limited-jwt', 'newSecret');
      expect(mockPost).toHaveBeenCalledWith('/auth/complete-first-login', {
        limitedToken: 'limited-jwt',
        newPassword: 'newSecret',
      });
    });
  });

  describe('confirmEmail', () => {
    it('sends GET to /auth/confirm/:id', async () => {
      mockGet.mockResolvedValue({ data: { confirmed: true } });
      await confirmEmail('conf-id-99');
      expect(mockGet).toHaveBeenCalledWith('/auth/confirm/conf-id-99');
    });
  });

  describe('forgotPassword', () => {
    it('posts to /auth/forgot-password with contactEmail', async () => {
      mockPost.mockResolvedValue({ data: { ok: true } });
      await forgotPassword('lost@test.com');
      expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', {
        contactEmail: 'lost@test.com',
      });
    });
  });

  describe('resetPassword', () => {
    it('posts to /auth/reset-password with token and newPassword', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });
      await resetPassword('reset-jwt-token', 'newPass');
      expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
        token: 'reset-jwt-token',
        newPassword: 'newPass',
      });
    });
  });

  describe('ssoLoginWithToken', () => {
    it('posts to /auth/sso/login-with-token with token', async () => {
      mockPost.mockResolvedValue({ data: { token: 'jwt-sso' } });
      await ssoLoginWithToken('sso-token-abc');
      expect(mockPost).toHaveBeenCalledWith('/auth/sso/login-with-token', {
        token: 'sso-token-abc',
      });
    });
  });
});
