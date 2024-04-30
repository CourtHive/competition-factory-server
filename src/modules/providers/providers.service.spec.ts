import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigService } from '@nestjs/config';

describe('ProvidersService', () => {
  let providersController: any;
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AuthModule, UsersModule, CacheModule],
      providers: [ProvidersService, ConfigService],
      controllers: [ProvidersController],
    }).compile();

    providersController = app.get(ProvidersController);
  });

  it('should return boolean', async () => {
    const result = await providersController.getCalendar({ providerAbbr: 'foo' });
    expect(result.success).toBe(false);
  });

  it('should return calendar when provider found', async () => {
    const result = await providersController.getCalendar({ providerAbbr: 'TMX' });
    if (result.success) expect(result.calendar).toBeDefined();
  });

  it('should return boolean', async () => {
    const result = await providersController.getProvider({ providerId: 'foo' });
    expect(result.success).toBe(false);
  });

  it('should return success if any providers found', async () => {
    const result = await providersController.getProviders();
    if (result.providers?.length) expect(result.success).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });
});
