import { ProvidersService } from './providers.service';
import { BadRequestException } from '@nestjs/common';

it('validates generic provider add/modify paths before their storage writes', async () => {
  const storage = {
    getProvider: vi.fn().mockResolvedValue({ organisationName: 'College', unrelated: true }),
    getProviders: vi.fn().mockResolvedValue([]),
    setProvider: vi.fn(),
  };
  const service = new ProvidersService(storage as any, {} as any, {} as any, {} as any, {} as any);
  const teamColors = {
    palette: [{ colorId: 'navy', value: '#13294b' }],
    display: { roles: { 'team.surface': 'missing' } },
  };
  await expect(service.addProvider({ organisationAbbreviation: 'COLLEGE', teamColors })).rejects.toBeInstanceOf(
    BadRequestException,
  );
  await expect(service.modifyProvider({ providerId: 'college', teamColors })).rejects.toBeInstanceOf(
    BadRequestException,
  );
  expect(storage.setProvider).not.toHaveBeenCalled();
  await service.modifyProvider({
    providerId: 'college',
    teamColors: { ...teamColors, display: { roles: { 'team.surface': 'navy' } } },
  });
  expect(storage.setProvider.mock.calls[0][1].teamColors.palette[0].value).toBe('#13294B');
  expect(storage.setProvider.mock.calls[0][1].unrelated).toBe(true);
  await service.modifyProvider({ providerId: 'college', teamColors: {} });
  expect(storage.setProvider.mock.calls[1][1]).not.toHaveProperty('teamColors');
});
