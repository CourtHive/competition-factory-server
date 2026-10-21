import { generateTournamentRecord } from './generateTournamentRecord';
import { BadRequestException } from '@nestjs/common';

const ctx = (overrides: any = {}) => ({
  userId: 'u1',
  email: 'u1@x.org',
  isSuperAdmin: false,
  globalRoles: ['client', 'generate'],
  providerRoles: { a: 'PROVIDER_ADMIN', b: 'PROVIDER_ADMIN' },
  providerIds: ['a', 'b'],
  ...overrides,
});

describe('generateTournamentRecord — the tournament belongs to the provider the session acts for', () => {
  it("stamps the chosen provider, not the user row's legacy home", async () => {
    const { tournamentRecord } = await generateTournamentRecord(
      {},
      { roles: ['client', 'generate'], providerId: 'a' /* the database home */ },
      ctx({ actingProviderId: 'b' }) as any,
    );
    expect(tournamentRecord.parentOrganisation.organisationId).toBe('b');
  });

  it('stamps the provider a provisioner request names', async () => {
    const provisioner = ctx({
      providerIds: ['managed'],
      providerRoles: { managed: 'PROVIDER_ADMIN' },
      actingProviderId: 'managed',
    });
    const { tournamentRecord } = await generateTournamentRecord(
      {},
      { roles: ['client', 'generate'] },
      provisioner as any,
    );
    expect(tournamentRecord.parentOrganisation.organisationId).toBe('managed');
  });

  it('refuses a session with several providers and no choice, rather than guessing', async () => {
    await expect(
      generateTournamentRecord({}, { roles: ['client', 'generate'], providerId: 'a' }, ctx() as any),
    ).rejects.toThrow('Choose a provider before generating a tournament');
  });

  it('a super-admin keeps a provider named in the profile', async () => {
    const { tournamentRecord } = await generateTournamentRecord(
      { tournamentAttributes: { parentOrganisation: { organisationId: 'named' } } },
      { roles: ['superadmin'] },
      ctx({ isSuperAdmin: true, actingProviderId: 'a' }) as any,
    );
    expect(tournamentRecord.parentOrganisation.organisationId).toBe('named');
  });
});

describe('generateTournamentRecord — a refused profile keeps its reason', () => {
  it('an unknown option is a 400 naming the option, not "[object Object]"', async () => {
    const attempt = generateTournamentRecord(
      { drawProfiles: [{ drawSzie: 4 }] },
      { roles: ['superadmin'] },
      ctx({ isSuperAdmin: true, actingProviderId: 'a' }) as any,
    );
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    const response: any = await attempt.catch((err) => err.getResponse());
    expect(response).toMatchObject({
      code: 'ERR_INVALID_VALUES',
      context: { option: 'drawProfiles[0].drawSzie' },
    });
  });
});
