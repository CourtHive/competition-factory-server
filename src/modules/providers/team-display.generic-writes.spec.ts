import { ProvidersService } from './providers.service';
import { BadRequestException } from '@nestjs/common';

// `PUT /provider/:providerId/team-display` is the only teamColors write path. Generic add/modify
// (`/provider/modify` admits any legacy ADMIN, unscoped) must REFUSE the field, never strip it silently.

const validColors = {
  palette: [{ colorId: 'navy', value: '#13294b' }],
  display: { roles: { 'team.surface': 'navy' } },
};
const storedColors = {
  palette: [{ colorId: 'gold', value: '#FFC72C' }],
  display: { roles: { 'team.surface': 'gold' } },
};

function makeService() {
  const storage = {
    getProvider: vi.fn().mockResolvedValue({ organisationName: 'College', teamColors: storedColors, unrelated: true }),
    getProviders: vi.fn().mockResolvedValue([]),
    setProvider: vi.fn(),
  };
  const service = new ProvidersService(storage as any, {} as any, {} as any, {} as any, {} as any);
  return { service, storage };
}

// A valid palette, a clear, null and malformed input are all refused: the field's presence is the refusal.
const payloads: Array<[string, unknown]> = [
  ['a valid palette', validColors],
  ['a clear ({})', {}],
  ['null', null],
  ['a malformed palette', { palette: 'navy' }],
];

describe.each(payloads)('generic provider writes carrying %s as teamColors', (_label, teamColors) => {
  it('addProvider refuses before reading or writing storage', async () => {
    const { service, storage } = makeService();
    const attempt = service.addProvider({ organisationAbbreviation: 'COLLEGE', teamColors });
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(/PUT \/provider\/:providerId\/team-display/);
    expect(storage.getProviders).not.toHaveBeenCalled();
    expect(storage.setProvider).not.toHaveBeenCalled();
  });

  it('modifyProvider refuses before reading or writing storage', async () => {
    const { service, storage } = makeService();
    const attempt = service.modifyProvider({ providerId: 'college', organisationName: 'Renamed', teamColors });
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(/PUT \/provider\/:providerId\/team-display/);
    expect(storage.getProvider).not.toHaveBeenCalled();
    expect(storage.setProvider).not.toHaveBeenCalled();
  });
});

it('generic writes without teamColors still succeed and leave stored defaults untouched', async () => {
  const { service, storage } = makeService();
  expect(await service.modifyProvider({ providerId: 'college', organisationName: 'Renamed' })).toMatchObject({
    success: true,
  });
  const saved = storage.setProvider.mock.calls[0][1];
  expect(saved.organisationName).toBe('Renamed');
  expect(saved.teamColors).toEqual(storedColors);
  expect(saved.unrelated).toBe(true);

  expect(await service.addProvider({ organisationAbbreviation: 'NEW', organisationName: 'New' })).toMatchObject({
    success: true,
  });
  expect(storage.setProvider.mock.calls[1][1]).not.toHaveProperty('teamColors');
});
