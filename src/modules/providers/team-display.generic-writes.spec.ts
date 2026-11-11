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
    patchProvider: vi.fn().mockResolvedValue({ success: true }),
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
    expect(storage.patchProvider).not.toHaveBeenCalled();
  });
});

it('generic writes without teamColors still succeed and never carry stored defaults', async () => {
  const { service, storage } = makeService();
  expect(await service.modifyProvider({ providerId: 'college', organisationName: 'Renamed' })).toMatchObject({
    success: true,
  });
  // modify sends ONLY the supplied keys; it never reads the record and writes it back whole, so a
  // stale teamColors can never ride along and undo a concurrent PUT /team-display.
  expect(storage.patchProvider).toHaveBeenCalledWith('college', { organisationName: 'Renamed' });
  expect(storage.getProvider).not.toHaveBeenCalled();
  expect(storage.setProvider).not.toHaveBeenCalled();

  expect(await service.addProvider({ organisationAbbreviation: 'NEW', organisationName: 'New' })).toMatchObject({
    success: true,
  });
  expect(storage.setProvider.mock.calls[0][1]).not.toHaveProperty('teamColors');
});

it('modifyProvider keeps the provider-not-found answer', async () => {
  const { service, storage } = makeService();
  storage.patchProvider.mockResolvedValue({ success: false });
  expect(await service.modifyProvider({ providerId: 'missing', organisationName: 'X' })).toEqual({
    error: 'Provider not found',
  });
  expect(await service.modifyProvider({ organisationName: 'No id' })).toEqual({ error: 'Provider not found' });
  expect(storage.patchProvider).toHaveBeenCalledTimes(1);
});
