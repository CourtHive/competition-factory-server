import { PostgresProviderStorage } from 'src/storage/postgres/postgres-provider.storage';
import { getPostgresConfig } from 'src/storage/postgres/postgres.config';
import { ProvisionerService } from '../provisioner/provisioner.service';
import { TeamDisplayController } from './team-display.controller';
import { ProvidersService } from './providers.service';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

// constants and types
import { PROVIDER_ADMIN } from 'src/common/constants/roles';

// `modifyProvider` and the scoped `PUT /provider/:providerId/team-display` write the same row. Each
// must change only its own keys, against the row as it is when its statement runs: a modify that read
// the record, waited, and wrote it back whole would silently undo a PUT that committed in between.
describe.skipIf(process.env.STORAGE_PROVIDER !== 'postgres')('provider partial writes in Postgres', () => {
  const pool = new Pool(getPostgresConfig());
  const storage = new PostgresProviderStorage(pool);
  const providers = new ProvidersService(storage, {} as any, {} as any, {} as any, {} as any);
  const noop = {} as any;
  const provisioner = new ProvisionerService(noop, noop, noop, storage, noop, noop, noop, noop, noop, noop, noop);
  const teamDisplay = new TeamDisplayController(pool);
  const created: string[] = [];

  const colors = (value: string) => ({
    palette: [{ colorId: 'primary', value }],
    display: { roles: { 'team.surface': 'primary' } },
  });

  async function seed() {
    const providerId = `test-provider-patch-${randomUUID()}`;
    created.push(providerId);
    await pool.query(
      'INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data) VALUES ($1, $2, $3, $4)',
      [providerId, providerId, 'Before', JSON.stringify({ unrelated: { keep: true } })],
    );
    const ctx = { providerRoles: { [providerId]: PROVIDER_ADMIN } } as any;
    return { providerId, put: (value: string) => teamDisplay.put(providerId, { teamColors: colors(value) }, ctx) };
  }

  async function storedData(providerId: string) {
    const { rows } = await pool.query(
      'SELECT organisation_name, organisation_abbreviation, data FROM providers WHERE provider_id = $1',
      [providerId],
    );
    return rows[0];
  }

  afterAll(async () => {
    await pool.query('DELETE FROM providers WHERE provider_id = ANY($1)', [created]);
    await pool.end();
  });

  it('modify after a team-display PUT changes only the supplied keys and keeps teamColors', async () => {
    const { providerId, put } = await seed();
    await put('#13294b');
    expect(await providers.modifyProvider({ providerId, organisationName: 'Renamed', onlineResources: [] })).toEqual({
      success: true,
    });

    const row = await storedData(providerId);
    expect(row.organisation_name).toBe('Renamed');
    expect(row.organisation_abbreviation).toBe(providerId);
    expect(row.data.teamColors.palette[0].value).toBe('#13294B');
    expect(row.data.unrelated).toEqual({ keep: true });
    expect(row.data.onlineResources).toEqual([]);
    // Column-backed fields stay in their columns, never duplicated into data.
    expect(row.data).not.toHaveProperty('organisationName');
  });

  it('a PUT that commits between a modify starting and writing is not undone', async () => {
    const { providerId, put } = await seed();
    await put('#111111');
    // What a modify's start sees; the old read-modify-write wrote exactly this copy back.
    const atModifyStart = await storage.getProvider(providerId);
    await put('#222222');
    await providers.modifyProvider({ providerId, organisationName: 'Renamed' });
    expect((await storedData(providerId)).data.teamColors.palette[0].value).toBe('#222222');

    // Falsification: the replaced write shape, run on the same interleaving, DOES lose the PUT.
    await put('#333333');
    await storage.setProvider(providerId, { ...atModifyStart, organisationName: 'Renamed' });
    expect((await storedData(providerId)).data.teamColors.palette[0].value).toBe('#111111');
  });

  it('a modify blocked on the row lock of an in-flight PUT merges onto the committed PUT', async () => {
    const { providerId } = await seed();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE providers SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{teamColors}', $2::jsonb, true) WHERE provider_id = $1",
        [providerId, JSON.stringify(colors('#444444'))],
      );
      // The modify's single statement waits on the row lock held by the open PUT transaction...
      const modify = providers.modifyProvider({ providerId, organisationName: 'Renamed' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await client.query('COMMIT');
      // ...and under READ COMMITTED re-reads the committed row before applying its merge.
      expect(await modify).toEqual({ success: true });
    } finally {
      client.release();
    }
    const row = await storedData(providerId);
    expect(row.organisation_name).toBe('Renamed');
    expect(row.data.teamColors.palette[0].value).toBe('#444444');
  });

  it('provisioner updateProviderConfig keeps teamColors and unrelated keys', async () => {
    const { providerId, put } = await seed();
    await put('#555555');
    expect(
      await provisioner.updateProviderConfig(providerId, { inactive: true, providerConfigCaps: { x: 1 } }),
    ).toEqual({ success: true });
    const row = await storedData(providerId);
    expect(row.data).toMatchObject({ inactive: true, providerConfigCaps: { x: 1 }, unrelated: { keep: true } });
    expect(row.data.teamColors.palette[0].value).toBe('#555555');
  });

  it('keeps the not-found answers when no provider row matches', async () => {
    const providerId = `test-provider-patch-missing-${randomUUID()}`;
    expect(await providers.modifyProvider({ providerId, organisationName: 'X' })).toEqual({
      error: 'Provider not found',
    });
    expect(await provisioner.updateProviderConfig(providerId, { inactive: true })).toEqual({
      error: 'Provider not found',
      code: 'PROVIDER_NOT_FOUND',
    });
    expect(await storage.patchProvider(providerId, { inactive: true })).toEqual({ success: false });
  });
});
