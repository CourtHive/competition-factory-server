import { Logger, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let authService: AuthService;
  let mockUsersService: any;
  let jwtService: JwtService;
  let mockCacheManager: any;
  let mockProviderStorage: any;
  let mockAuthCodeStorage: any;
  let mockUserStorage: any;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret' });

    mockUsersService = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
    };

    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    mockProviderStorage = {
      getProvider: jest.fn(),
      updateLastAccess: jest.fn().mockResolvedValue(undefined),
    };

    mockAuthCodeStorage = {
      setResetCode: jest.fn(),
      getResetCode: jest.fn(),
      deleteResetCode: jest.fn(),
    };

    mockUserStorage = {
      update: jest.fn(),
      updateLastAccess: jest.fn().mockResolvedValue(undefined),
    };

    const mockUserProvisionerStorage = {
      findProvisionerIdsByUser: jest.fn().mockResolvedValue([]),
      findUsersByProvisioner: jest.fn().mockResolvedValue([]),
      associate: jest.fn().mockResolvedValue({ success: true }),
      disassociate: jest.fn().mockResolvedValue({ success: true }),
    };

    authService = new AuthService(
      mockUsersService,
      jwtService,
      mockCacheManager,
      mockProviderStorage,
      mockAuthCodeStorage,
      mockUserStorage,
      mockUserProvisionerStorage as any,
    );
  });

  describe('signIn', () => {
    it('throws UnauthorizedException when email is empty', async () => {
      await expect(authService.signIn('', 'password')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      await expect(authService.signIn('test@test.com', 'password')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password does not match', async () => {
      const hashed = await bcrypt.hash('correct-password', 10);
      mockUsersService.findOne.mockResolvedValue({ email: 'test@test.com', password: hashed, roles: ['client'] });
      await expect(authService.signIn('test@test.com', 'wrong-password')).rejects.toThrow(UnauthorizedException);
    });

    it('returns token for valid cleartext password match', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'test@test.com', password: 'secret', roles: ['client'] });
      const result = await authService.signIn('test@test.com', 'secret');
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
    });

    it('returns token for valid bcrypt password match', async () => {
      const hashed = await bcrypt.hash('my-password', 10);
      mockUsersService.findOne.mockResolvedValue({ email: 'test@test.com', password: hashed, roles: ['admin'] });
      const result = await authService.signIn('test@test.com', 'my-password');
      expect(result.token).toBeDefined();
    });

    it('enriches user details with provider when providerId exists', async () => {
      const provider = { organisationName: 'TestOrg' };
      mockUsersService.findOne.mockResolvedValue({
        email: 'admin@test.com',
        password: 'pass',
        roles: ['admin'],
        providerId: 'p1',
      });
      mockProviderStorage.getProvider.mockResolvedValue(provider);

      const result = await authService.signIn('admin@test.com', 'pass');
      expect(mockProviderStorage.getProvider).toHaveBeenCalledWith('p1');
      expect(result.token).toBeDefined();
    });

    it('updates lastAccess for both user and provider on successful login', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'la@test.com', password: 'pass', roles: ['admin'], providerId: 'p1',
      });
      mockProviderStorage.getProvider.mockResolvedValue({ organisationName: 'O' });

      await authService.signIn('la@test.com', 'pass');
      // flush fire-and-forget .catch handlers
      await Promise.resolve();

      expect(mockUserStorage.updateLastAccess).toHaveBeenCalledWith('la@test.com');
      expect(mockProviderStorage.updateLastAccess).toHaveBeenCalledWith('p1');
    });

    it('logs (but does not throw) when updateLastAccess fails', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'fail@test.com', password: 'pass', roles: ['client'], providerId: 'p1',
      });
      mockProviderStorage.getProvider.mockResolvedValue({});
      mockUserStorage.updateLastAccess.mockRejectedValueOnce(new Error('db down'));
      mockProviderStorage.updateLastAccess.mockRejectedValueOnce(new Error('db down'));
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);

      const result = await authService.signIn('fail@test.com', 'pass');
      // both .catch handlers run on the next microtask — flush a few times
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(result.token).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('invite', () => {
    it('returns error when email is empty', async () => {
      const result = await authService.invite({});
      expect(result.error).toBe('Email is required');
    });

    it('returns error when user already exists', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'existing@test.com' });
      const result = await authService.invite({ email: 'existing@test.com' });
      expect(result.error).toBe('Existing user');
    });

    it('returns invite code for new user', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      const result = await authService.invite({ email: 'new@test.com', roles: ['client'] });
      expect(result.inviteCode).toBeDefined();
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('throws when invitation code is invalid', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      await expect(authService.register({ code: 'bad-code' })).rejects.toThrow(UnauthorizedException);
    });

    it('creates user with valid invitation code', async () => {
      mockCacheManager.get.mockResolvedValue({ email: 'new@test.com', roles: ['client'] });
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });
      const result: any = await authService.register({ code: 'valid-code', password: 'pass123' });
      expect(result.success).toBe(true);
      expect(mockCacheManager.del).toHaveBeenCalledWith('invite:valid-code');
    });

    it('returns error if user creation fails', async () => {
      mockCacheManager.get.mockResolvedValue({ email: 'new@test.com' });
      mockUsersService.create.mockResolvedValue({ error: 'Email exists' });
      const result = await authService.register({ code: 'valid-code' });
      expect(result.error).toBe('Email exists');
    });
  });

  describe('forgotPassword', () => {
    it('returns error when user not found', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      const result = await authService.forgotPassword('missing@test.com');
      expect(result).toEqual({ error: 'User not found' });
    });

    it('sets reset code and returns email', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'user@test.com' });
      const result = await authService.forgotPassword('user@test.com');
      expect(result).toBe('user@test.com');
      expect(mockAuthCodeStorage.setResetCode).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('returns error for invalid reset code', async () => {
      mockAuthCodeStorage.getResetCode.mockResolvedValue(null);
      const result = await authService.resetPassword('bad-code', 'new-pass');
      expect(result).toEqual({ error: 'Invalid reset code' });
    });

    it('returns error when user not found', async () => {
      mockAuthCodeStorage.getResetCode.mockResolvedValue({ email: 'gone@test.com' });
      mockUsersService.findOne.mockResolvedValue(null);
      const result = await authService.resetPassword('valid-code', 'new-pass');
      expect(result).toEqual({ error: 'User not found' });
    });

    it('updates password and returns success', async () => {
      mockAuthCodeStorage.getResetCode.mockResolvedValue({ email: 'user@test.com' });
      mockUsersService.findOne.mockResolvedValue({ email: 'user@test.com', password: 'old' });
      mockUserStorage.update.mockResolvedValue(undefined);
      const result: any = await authService.resetPassword('valid-code', 'new-pass');
      expect(result.success).toBe(true);
      expect(mockUserStorage.update).toHaveBeenCalledWith('user@test.com', expect.objectContaining({ email: 'user@test.com' }));
    });
  });

  describe('decode', () => {
    it('decodes a valid JWT', async () => {
      const token = jwtService.sign({ email: 'test@test.com' }, { secret: 'test-secret' });
      const result = await authService.decode(token);
      expect(result.email).toBe('test@test.com');
    });

    it('throws UnauthorizedException for invalid token', async () => {
      await expect(authService.decode('invalid.token.here')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('removeUser / getUsers', () => {
    it('delegates removeUser to usersService', async () => {
      mockUsersService.remove.mockResolvedValue({ success: true });
      const result = await authService.removeUser({ email: 'user@test.com' });
      expect(mockUsersService.remove).toHaveBeenCalledWith('user@test.com');
      expect(result.success).toBe(true);
    });

    it('delegates getUsers to usersService', async () => {
      const users = [{ email: 'a@test.com' }, { email: 'b@test.com' }];
      mockUsersService.findAll.mockResolvedValue(users);
      const result = await authService.getUsers();
      expect(result).toBe(users);
    });
  });
});
