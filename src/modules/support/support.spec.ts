import { SupportService } from './support.service';
import { SupportWorker } from './support.worker';
import { SupportStore } from './support.store';
import { parseReport } from './support-input';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const evidence = () => ({
  route: 'events',
  online: true,
  version: '8.1.0',
  diagnostics: [{ time: new Date().toISOString(), code: 'MUTATION_REFUSED', method: 'addEvent', route: 'events' }],
  validation: {
    count: 0,
    schemaErrorCount: 0,
    inconsistencyCount: 0,
    schemaUnavailable: false,
    integrityUnavailable: false,
    truncated: false,
    codes: [],
  },
});
const report = () => ({ submissionKey: randomUUID(), description: 'Creation was refused', evidence: evidence() });
const identity = (userId = randomUUID(), provider = 'support-provider'): any => ({
  userId,
  providerIds: [provider],
  providerRoles: { [provider]: 'PROVIDER_ADMIN' },
  actingProviderId: provider,
  isSuperAdmin: false,
});

// constants and types
import { getPostgresConfig } from 'src/storage/postgres/postgres.config';

describe('description-only evidence boundary', () => {
  it('accepts the small contract and refuses source IDs, snapshots, messages and invalid byte bounds', () => {
    expect(parseReport(report()).evidence.diagnostics[0].code).toBe('MUTATION_REFUSED');
    const mutations = [
      { ...report(), tournamentRecord: { participants: [] } },
      { ...report(), evidence: { ...evidence(), route: '/tournament/private-person-id/events' } },
      {
        ...report(),
        evidence: { ...evidence(), diagnostics: [{ ...evidence().diagnostics[0], participantId: 'private' }] },
      },
      { ...report(), evidence: { ...evidence(), validation: { ...evidence().validation, message: 'Alice is 12' } } },
      {
        ...report(),
        evidence: { ...evidence(), diagnostics: [{ ...evidence().diagnostics[0], code: 'ALICE_SMITH' }] },
      },
      { ...report(), description: 'é'.repeat(4097) },
    ];
    for (const input of mutations) expect(() => parseReport(input)).toThrow();
  });

  it('fails closed for missing context, API keys and ordinary inbox access', async () => {
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'true');
    const service = new SupportService({} as any, {} as any, {} as any, {} as any);
    expect(() => service.identity()).toThrow();
    expect(() => service.identity({ ...identity(), apiKey: 'provider' })).toThrow();
    expect(() => service.list(0, identity())).toThrow();
    await expect(service.submit(report(), { ...identity(), providerSelectionPending: true })).rejects.toThrow();
    await expect(service.submit(report(), { ...identity(), actingProviderId: 'another-provider' })).rejects.toThrow();
    vi.unstubAllEnvs();
  });

  it('authorizes the source against metadata and rejects another provider even for an otherwise valid user', async () => {
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'true');
    const store = { submit: vi.fn() };
    const tournaments = { fetchTournamentUpdatedAt: vi.fn().mockResolvedValue({ success: true, providerId: 'other' }) };
    const service = new SupportService(store as any, tournaments as any, {} as any, {} as any);
    await expect(service.submit({ ...report(), tournamentId: 'source' }, identity())).rejects.toThrow();
    expect(store.submit).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe.skipIf(process.env.STORAGE_PROVIDER !== 'postgres')('support persistence and durable send loop', () => {
  let pool: Pool;
  let store: SupportStore;
  beforeAll(() => {
    pool = new Pool(getPostgresConfig());
    store = new SupportStore(pool);
  });
  beforeEach(async () => {
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'true');
    await pool.query('TRUNCATE support_cases');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await pool.query('TRUNCATE support_cases');
    await pool.end();
  });

  it('deduplicates concurrent retries, refuses changed intent, and applies user/provider quotas', async () => {
    const ctx = identity();
    const body = parseReport(report());
    const rows = await Promise.all(
      Array.from({ length: 5 }, () => store.submit(body, ctx.userId, ctx.actingProviderId)),
    );
    expect(new Set(rows.map((r) => r.reference)).size).toBe(1);
    await expect(store.submit({ ...body, description: 'changed' }, ctx.userId, ctx.actingProviderId)).rejects.toThrow(
      'already used',
    );
    await store.submit(parseReport(report()), ctx.userId, ctx.actingProviderId);
    await store.submit(parseReport(report()), ctx.userId, ctx.actingProviderId);
    await expect(store.submit(parseReport(report()), ctx.userId, ctx.actingProviderId)).rejects.toMatchObject({
      status: 429,
    });
    for (let i = 0; i < 17; i++) await store.submit(parseReport(report()), randomUUID(), ctx.actingProviderId);
    await expect(store.submit(parseReport(report()), randomUUID(), ctx.actingProviderId)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('projects only own receipt status and denies ordinary reads/resolution writes', async () => {
    const ctx = identity();
    const row = await store.submit(parseReport(report()), ctx.userId, ctx.actingProviderId);
    const users = {
      findByUserId: vi.fn().mockResolvedValue({ contactEmail: 'operator@example.test', emailVerifiedAt: 'now' }),
    };
    const service = new SupportService(store, {} as any, {} as any, users as any);
    const receipt = await service.receipt(row.reference, ctx);
    expect(receipt.contact).toBe('verified');
    expect(JSON.stringify(receipt)).not.toContain('description');
    expect(JSON.stringify(receipt)).not.toContain('operator@example.test');
    await expect(service.receipt(row.reference, identity())).rejects.toThrow();
    expect(() => service.show(row.reference, ctx)).toThrow();
    expect(() => service.resolve(row.reference, { resolution: 'fixed' }, ctx)).toThrow();
    const admin = { ...ctx, isSuperAdmin: true };
    await service.resolve(row.reference, { resolution: 'fixed' }, admin);
    await expect(service.resolve(row.reference, { resolution: 'changed' }, admin)).rejects.toThrow();
  });

  it('waits for verified contact, persists the send lease before transport, retries the same key, then reports delivery unknown', async () => {
    const ctx = identity();
    const row = await store.submit(parseReport(report()), ctx.userId, ctx.actingProviderId);
    await store.resolve(row.reference, 'Resolved in the next release', 'admin-test');
    const users = {
      findByUserId: vi.fn().mockResolvedValue({ contactEmail: 'operator@example.test', emailVerifiedAt: null }),
    };
    const transport = { notify: vi.fn().mockResolvedValue(undefined), send: vi.fn() };
    const worker = new SupportWorker(store, transport as any, users as any);
    await worker.tick();
    expect(transport.send).not.toHaveBeenCalled();
    expect((await store.get(row.reference)).send_state).toBe('awaiting_contact');
    users.findByUserId.mockResolvedValue({ contactEmail: 'operator@example.test', emailVerifiedAt: 'verified' });
    transport.send
      .mockImplementationOnce(async () => {
        const intent = await store.get(row.reference); // separate connection proves the lease committed before I/O
        expect(intent.send_attempts).toBe(1);
        expect(intent.send_email).toBe('operator@example.test');
        expect(intent.send_started_at).toBeTruthy();
        throw new Error('response lost');
      })
      .mockResolvedValue('mail-receipt');
    await pool.query('UPDATE support_cases SET send_after=now() WHERE reference=$1', [row.reference]);
    await worker.tick();
    const started = (await store.get(row.reference)).send_started_at;
    await pool.query('UPDATE support_cases SET send_after=now() WHERE reference=$1', [row.reference]);
    await new SupportWorker(store, transport as any, users as any).tick();
    expect(transport.send.mock.calls[0][3]).toBe(transport.send.mock.calls[1][3]);
    expect((await store.get(row.reference)).send_started_at).toEqual(started);
    const service = new SupportService(store, {} as any, {} as any, users as any);
    expect(await service.receipt(row.reference, ctx)).toMatchObject({
      resolutionEmail: 'accepted',
      delivery: 'unknown',
    });
    expect(
      transport.notify.mock.calls.every(
        ([ref, kind]) => ref === row.reference && ['received', 'send_failed', 'recovered'].includes(kind),
      ),
    ).toBe(true);
  });

  it('does not race two workers into duplicate sends or reuse a key with a changed recipient', async () => {
    const ctx = identity();
    const row = await store.submit(parseReport(report()), ctx.userId, ctx.actingProviderId);
    await store.resolve(row.reference, 'Resolution', 'admin-test');
    const users = {
      findByUserId: vi.fn().mockResolvedValue({ contactEmail: 'first@example.test', emailVerifiedAt: 'verified' }),
    };
    const transport = {
      notify: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockRejectedValue(new Error('lost response')),
    };
    await Promise.all([
      new SupportWorker(store, transport as any, users as any).tick(),
      new SupportWorker(store, transport as any, users as any).tick(),
    ]);
    expect(transport.send).toHaveBeenCalledTimes(1);
    users.findByUserId.mockResolvedValue({ contactEmail: 'changed@example.test', emailVerifiedAt: 'verified' });
    await pool.query('UPDATE support_cases SET send_after=now() WHERE reference=$1', [row.reference]);
    await new SupportWorker(store, transport as any, users as any).tick();
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect((await store.get(row.reference)).send_error).toBe('manual_review_required');
  });

  it('expires open cases without reads, retries, emails or alerts and purges content', async () => {
    const ctx = identity();
    const row = await store.submit(parseReport(report()), ctx.userId, ctx.actingProviderId);
    await store.resolve(row.reference, 'not yet delivered', 'admin-test');
    await pool.query("UPDATE support_cases SET expires_at=now()-interval '1 second' WHERE reference=$1", [
      row.reference,
    ]);
    await expect(store.get(row.reference)).rejects.toThrow();
    expect((await store.list()).reports).toHaveLength(0);
    const transport = { send: vi.fn(), notify: vi.fn() };
    await new SupportWorker(store, transport as any, {} as any).tick();
    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.notify).not.toHaveBeenCalled();
    expect((await pool.query('SELECT count(*) FROM support_cases')).rows[0].count).toBe('0');
  });
});
