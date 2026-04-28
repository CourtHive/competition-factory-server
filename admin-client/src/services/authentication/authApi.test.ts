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
  inviteUser,
  systemRegister,
  setPassword,
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

  describe('inviteUser', () => {
    it('posts to /auth/invite with all parameters and a default DIRECTOR providerRole', async () => {
      mockPost.mockResolvedValue({ data: { inviteCode: 'abc123' } });
      await inviteUser('new@test.com', 'org-1', ['admin', 'client'], ['devMode'], ['tournamentProfile']);
      expect(mockPost).toHaveBeenCalledWith('/auth/invite', {
        email: 'new@test.com',
        providerId: 'org-1',
        providerRole: 'DIRECTOR',
        roles: ['admin', 'client'],
        permissions: ['devMode'],
        services: ['tournamentProfile'],
      });
    });

    it('forwards an explicit PROVIDER_ADMIN providerRole', async () => {
      mockPost.mockResolvedValue({ data: { inviteCode: 'abc123' } });
      await inviteUser(
        'new@test.com',
        'org-1',
        ['admin', 'client'],
        ['devMode'],
        ['tournamentProfile'],
        'PROVIDER_ADMIN',
      );
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/invite',
        expect.objectContaining({ providerRole: 'PROVIDER_ADMIN' }),
      );
    });
  });

  describe('systemRegister', () => {
    it('posts to /auth/register with user details and invite code', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });
      await systemRegister('Jane', 'Doe', 'password1', 'invite-code');
      expect(mockPost).toHaveBeenCalledWith('/auth/register', {
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'password1',
        code: 'invite-code',
      });
    });
  });

  describe('setPassword', () => {
    it('posts to /auth/set-password with password and token', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });
      await setPassword('newPass', 'token-xyz');
      expect(mockPost).toHaveBeenCalledWith('/auth/set-password', {
        password: 'newPass',
        setPasswordToken: 'token-xyz',
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
    it('posts to /auth/forgot-password with email', async () => {
      mockPost.mockResolvedValue({ data: {} });
      await forgotPassword('lost@test.com');
      expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', {
        email: 'lost@test.com',
      });
    });
  });

  describe('resetPassword', () => {
    it('posts to /auth/reset-password with email, password, and code', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });
      await resetPassword('user@test.com', 'newPass', 'reset-code');
      expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
        email: 'user@test.com',
        password: 'newPass',
        code: 'reset-code',
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
