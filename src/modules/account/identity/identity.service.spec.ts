import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { IdentityService } from './identity.service';

describe('IdentityService', () => {
  let identityService: IdentityService;
  let jwtService: JwtService;
  let mockUserStorage: any;
  let mockEmailService: any;
  let mockConfigService: any;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret' });

    mockUserStorage = {
      findOne: jest.fn(),
      findByContactEmail: jest.fn(),
      setContactEmail: jest.fn().mockResolvedValue({ success: true }),
      markEmailVerified: jest.fn().mockResolvedValue({ success: true }),
    };
    mockEmailService = {
      sendTemplated: jest.fn().mockResolvedValue({ id: 'msg-123' }),
    };
    mockConfigService = {
      get: jest.fn().mockReturnValue({ baseUrl: 'https://nest.test.example' }),
    };

    identityService = new IdentityService(
      jwtService,
      mockEmailService,
      mockConfigService,
      mockUserStorage,
    );
  });

  describe('setContactEmail', () => {
    it('rejects an empty address', async () => {
      const result: any = await identityService.setContactEmail({ userId: 'u-1' }, '');
      expect(result.error).toContain('required');
    });

    it('rejects a non-RFC-shaped string', async () => {
      const result: any = await identityService.setContactEmail({ userId: 'u-1' }, 'not-an-email');
      expect(result.error).toContain('valid email');
    });

    it('writes the address (unverified), sends mail, returns pending status', async () => {
      const result: any = await identityService.setContactEmail(
        { userId: 'u-1', firstName: 'Alice' },
        '  Alice@Example.COM  ',
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('pending_verification');
      expect(result.contactEmail).toBe('Alice@Example.COM');
      expect(mockUserStorage.setContactEmail).toHaveBeenCalledWith('u-1', 'Alice@Example.COM');
      expect(mockEmailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'Alice@Example.COM',
          template: 'email-verification',
          tag: 'email-verification',
          data: expect.objectContaining({ firstName: 'Alice', email: 'Alice@Example.COM' }),
        }),
      );
      // The verify URL embeds the configured base URL.
      const sendCall = (mockEmailService.sendTemplated as jest.Mock).mock.calls[0][0];
      expect(sendCall.data.verifyUrl).toMatch(/^https:\/\/nest\.test\.example\/admin\/#\/verify-email\//);
    });

    it('throws when APP_BASE_URL is not configured', async () => {
      mockConfigService.get.mockReturnValue({});
      const previous = process.env.APP_BASE_URL;
      delete process.env.APP_BASE_URL;
      try {
        await expect(
          identityService.setContactEmail({ userId: 'u-1' }, 'alice@example.com'),
        ).rejects.toThrow(/APP_BASE_URL/);
      } finally {
        if (previous !== undefined) process.env.APP_BASE_URL = previous;
      }
    });
  });

  describe('resendVerification', () => {
    it('is a no-op when the user has no contact_email yet', async () => {
      mockUserStorage.findOne.mockResolvedValue({ contactEmail: null });
      const result: any = await identityService.resendVerification({
        userId: 'u-1',
        email: 'u-1@login',
      });
      expect(result.status).toBe('no_contact_email');
      expect(mockEmailService.sendTemplated).not.toHaveBeenCalled();
    });

    it('is a no-op when contact_email is already verified', async () => {
      mockUserStorage.findOne.mockResolvedValue({
        contactEmail: 'alice@example.com',
        emailVerifiedAt: '2026-05-22T10:00:00Z',
      });
      const result: any = await identityService.resendVerification({
        userId: 'u-1',
        email: 'u-1@login',
      });
      expect(result.status).toBe('already_verified');
      expect(mockEmailService.sendTemplated).not.toHaveBeenCalled();
    });

    it('sends a fresh verification mail when contact_email is pending', async () => {
      mockUserStorage.findOne.mockResolvedValue({
        contactEmail: 'alice@example.com',
        emailVerifiedAt: null,
        firstName: 'Alice',
      });
      const result: any = await identityService.resendVerification({
        userId: 'u-1',
        email: 'u-1@login',
        firstName: 'Alice',
      });
      expect(result.status).toBe('pending_verification');
      expect(mockEmailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com', tag: 'email-verification' }),
      );
    });
  });

  describe('verifyEmailToken', () => {
    it('rejects a missing token', async () => {
      await expect(identityService.verifyEmailToken('')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a malformed token', async () => {
      await expect(identityService.verifyEmailToken('not-a-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token without the verification purpose', async () => {
      const wrong = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'something-else' },
        { expiresIn: '5m' },
      );
      await expect(identityService.verifyEmailToken(wrong)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the contact_email has changed since the token was issued', async () => {
      const token = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'email-verification' },
        { expiresIn: '5m' },
      );
      mockUserStorage.findOne.mockResolvedValue(null);
      mockUserStorage.findByContactEmail.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'bob@example.com', // user changed it after the token was issued
      });
      await expect(identityService.verifyEmailToken(token)).rejects.toThrow(ForbiddenException);
      expect(mockUserStorage.markEmailVerified).not.toHaveBeenCalled();
    });

    it('marks the email verified on a valid matching token', async () => {
      const token = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'email-verification' },
        { expiresIn: '5m' },
      );
      mockUserStorage.findOne.mockResolvedValue(null);
      mockUserStorage.findByContactEmail.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'alice@example.com',
      });

      const result: any = await identityService.verifyEmailToken(token);

      expect(result.success).toBe(true);
      expect(result.contactEmail).toBe('alice@example.com');
      expect(mockUserStorage.markEmailVerified).toHaveBeenCalledWith('u-1');
    });
  });
});
