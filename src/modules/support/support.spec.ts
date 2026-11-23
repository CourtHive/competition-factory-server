import { SUPPORT_REFUSAL, SupportService } from './support.service';
import { SupportWorker } from './support.worker';
import { SupportStore } from './support.store';
import { parseReport } from './support-input';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
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
const report = () => ({
  expectedReporter: 'test-reporter',
  expectedProvider: 'support-provider',
  submissionKey: randomUUID(),
  description: 'Creation was refused',
  evidence: evidence(),
});
const identity = (userId: string = randomUUID(), provider = 'support-provider'): any => ({
  userId,
  providerIds: [provider],
  providerRoles: { [provider]: 'PROVIDER_ADMIN' },
  actingProviderId: provider,
  isSuperAdmin: false,
});

const without = (value: Record<string, any>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
// Provider storage: 'support-provider' and 'boboca' exist, nothing else.
const providers: any = {
  getProvider: vi.fn(async (id: string) =>
    ['support-provider', 'boboca'].includes(id) ? { providerId: id } : undefined,
  ),
};
const providerTarget = (providerId = 'support-provider') => ({ scope: 'provider' as const, providerId });

// constants and types
import { getPostgresConfig } from 'src/storage/postgres/postgres.config';

describe('description-only evidence boundary', () => {
  it('accepts the small contract and refuses source IDs, snapshots, messages and invalid byte bounds', () => {
    expect(parseReport(report()).evidence).toMatchObject({ diagnostics: [{ code: 'MUTATION_REFUSED' }] });
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
    vi.stubEnv('SUPPORT_DISPATCH_ENABLED', 'true');
    const service = new SupportService({} as any, {} as any, {} as any, {} as any, providers);
    expect(() => service.identity()).toThrow();
    expect(() => service.identity({ ...identity(), apiKey: 'provider' })).toThrow();
    expect(() => service.list(0, identity())).toThrow();
    await expect(service.submit(report(), { ...identity(), providerSelectionPending: true })).rejects.toThrow();
    await expect(service.submit(report(), { ...identity(), actingProviderId: 'another-provider' })).rejects.toThrow();
    vi.unstubAllEnvs();
  });

  it('names the reason for every refusal and logs it without report content', async () => {
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'true');
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const service = new SupportService({} as any, {} as any, {} as any, {} as any, providers);
    const code = (value: string) => ({ response: expect.objectContaining({ code: value }) });
    expect(() => service.identity()).toThrow(expect.objectContaining(code(SUPPORT_REFUSAL.IDENTITY_REQUIRED)));
    expect(() => service.list(0, identity())).toThrow(expect.objectContaining(code(SUPPORT_REFUSAL.ADMIN_REQUIRED)));
    // A super-admin impersonating a provider that does not exist (impersonation itself is accepted: see below).
    const superAdmin = {
      ...identity(),
      providerIds: [],
      providerRoles: {},
      actingProviderId: undefined,
      isSuperAdmin: true,
    };
    await expect(service.submit({ ...report(), expectedProvider: 'missing' }, superAdmin)).rejects.toMatchObject({
      status: 403,
      ...code(SUPPORT_REFUSAL.PROVIDER_UNKNOWN),
    });
    await expect(
      service.submit(report(), { ...identity(), actingProviderId: 'another-provider' }),
    ).rejects.toMatchObject(code(SUPPORT_REFUSAL.PROVIDER_NOT_PERMITTED));
    await expect(service.submit({ ...report(), expectedProvider: 'elsewhere' }, identity())).rejects.toMatchObject(
      code(SUPPORT_REFUSAL.SESSION_CHANGED),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(SUPPORT_REFUSAL.PROVIDER_UNKNOWN), 'Support');
    const logged = warn.mock.calls.map(([line]) => String(line)).join('\n');
    expect(logged).not.toContain('Creation was refused'); // the report description never reaches the log
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'false');
    await expect(service.submit(report(), identity())).rejects.toMatchObject({
      status: 503,
      ...code(SUPPORT_REFUSAL.INTAKE_DISABLED),
    });
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it('disables only new submissions while existing reports remain available to their authorized readers', async () => {
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'false');
    const reference = randomUUID();
    const ctx = identity();
    const row = { reference, reporter_id: ctx.userId, send_state: 'pending' };
    const store = {
      get: vi.fn().mockResolvedValue(row),
      list: vi.fn().mockResolvedValue([row]),
      resolve: vi.fn(),
      submit: vi.fn(),
    };
    const users = { findByUserId: vi.fn().mockResolvedValue({}) };
    const service = new SupportService(store as any, {} as any, {} as any, users as any, providers);
    await expect(service.submit(report(), ctx)).rejects.toMatchObject({ status: 503 });
    expect(store.submit).not.toHaveBeenCalled();
    await expect(service.receipt(reference, ctx)).resolves.toMatchObject({ accepted: true });
    const admin = { ...ctx, isSuperAdmin: true };
    await expect(service.list(0, admin)).resolves.toEqual([row]);
    await expect(service.show(reference, admin)).resolves.toEqual(row);
    service.resolve(reference, { resolution: 'Fixed' }, admin);
    expect(store.resolve).toHaveBeenCalledWith(reference, 'Fixed', admin.userId);
    expect(() => service.list(0, ctx)).toThrow();
    await expect(service.receipt(reference, identity())).rejects.toMatchObject({ status: 404 });
    vi.unstubAllEnvs();
  });

  it('keeps expiry cleanup running while report submission and outbound work are disabled', async () => {
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'false');
    vi.stubEnv('SUPPORT_DISPATCH_ENABLED', 'false');
    vi.useFakeTimers();
    const store = { purge: vi.fn().mockResolvedValue(undefined), pool: { connect: vi.fn() } };
    const transport = { ready: vi.fn(), send: vi.fn(), notify: vi.fn() };
    const worker = new SupportWorker(store as any, transport as any, {} as any);
    await worker.onApplicationBootstrap();
    await worker.tick();
    await vi.advanceTimersByTimeAsync(60_000);
    await worker.onModuleDestroy();
    expect(store.purge.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(store.pool.connect).not.toHaveBeenCalled();
    expect(transport.ready).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('authorizes the source against metadata and rejects another provider even for an otherwise valid user', async () => {
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'true');
    vi.stubEnv('SUPPORT_DISPATCH_ENABLED', 'true');
    const store = { submit: vi.fn() };
    const tournaments = { fetchTournamentUpdatedAt: vi.fn().mockResolvedValue({ success: true, providerId: 'other' }) };
    const service = new SupportService(store as any, tournaments as any, {} as any, {} as any, providers);
    await expect(service.submit({ ...report(), tournamentId: 'source' }, identity('test-reporter'))).rejects.toThrow();
    expect(store.submit).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

// CA, 2026-11-22: anyone signed in sends feedback; provider scope when a provider is selected, platform otherwise; a
// super-admin's impersonation scopes the report; suggestions beside bug reports.
describe('feedback scope and kind', () => {
  // The reporter fence matches report()'s expectedReporter, so only the scope decides each case below.
  const reporter = () => identity('test-reporter');
  const platformReport = () => without(report(), 'expectedProvider');
  const noProvider = () => ({ ...reporter(), providerIds: [], providerRoles: {}, actingProviderId: undefined });
  const superAdmin = () => ({ ...noProvider(), isSuperAdmin: true });
  const accepting = () => {
    const store = { submit: vi.fn(async () => ({ reference: randomUUID() })), get: vi.fn() };
    const service = new SupportService(store as any, {} as any, {} as any, {} as any, providers);
    vi.spyOn(service, 'receipt').mockResolvedValue({ accepted: true } as any);
    return { store, service };
  };
  beforeEach(() => vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  it('parses a suggestion without diagnostics and refuses error evidence or an unknown kind', () => {
    const minimal = without(evidence(), 'diagnostics', 'validation');
    const parsed = parseReport({ ...report(), kind: 'suggestion', evidence: minimal });
    expect(parsed).toMatchObject({ kind: 'suggestion', evidence: { route: 'events', online: true, version: '8.1.0' } });
    expect(parseReport(report()).kind).toBe('bug');
    expect(parseReport(platformReport()).expectedProvider).toBeUndefined();
    expect(() => parseReport({ ...report(), kind: 'suggestion' })).toThrow(); // diagnostics on a suggestion
    expect(() => parseReport({ ...report(), kind: 'praise' })).toThrow();
  });

  it('sends platform feedback for a signed-in user with no provider selected', async () => {
    const { store, service } = accepting();
    for (const ctx of [noProvider(), { ...reporter(), providerSelectionPending: true }]) {
      await service.submit(platformReport(), ctx);
      expect(store.submit).toHaveBeenLastCalledWith(expect.anything(), ctx.userId, { scope: 'platform' });
    }
    // The fence still holds: a form opened with a provider cannot land as platform feedback, or the reverse.
    await expect(service.submit(report(), noProvider())).rejects.toMatchObject({
      response: expect.objectContaining({ code: SUPPORT_REFUSAL.SESSION_CHANGED }),
    });
    await expect(service.submit(platformReport(), reporter())).rejects.toMatchObject({
      response: expect.objectContaining({ code: SUPPORT_REFUSAL.SESSION_CHANGED }),
    });
  });

  it("scopes a super-admin's report to the provider it impersonates, or to the platform with none", async () => {
    const { store, service } = accepting();
    const admin = superAdmin();
    await service.submit({ ...report(), expectedProvider: 'boboca' }, admin);
    expect(store.submit).toHaveBeenLastCalledWith(expect.anything(), admin.userId, providerTarget('boboca'));
    await service.submit(platformReport(), admin);
    expect(store.submit).toHaveBeenLastCalledWith(expect.anything(), admin.userId, { scope: 'platform' });
    // Only a super-admin's form names the provider: anyone else's selection is the session's.
    await expect(service.submit({ ...report(), expectedProvider: 'boboca' }, reporter())).rejects.toMatchObject({
      response: expect.objectContaining({ code: SUPPORT_REFUSAL.SESSION_CHANGED }),
    });
  });

  it('refuses a tournament on platform feedback, since a tournament belongs to a provider', async () => {
    const { store, service } = accepting();
    await expect(service.submit({ ...platformReport(), tournamentId: 'source' }, noProvider())).rejects.toMatchObject({
      response: expect.objectContaining({ code: SUPPORT_REFUSAL.TOURNAMENT_NOT_VISIBLE }),
    });
    expect(store.submit).not.toHaveBeenCalled();
  });

  it('tells the client what this session can send, with the same decision submit makes', async () => {
    const { service } = accepting();
    const kinds = ['bug', 'suggestion'];
    await expect(service.capability(undefined, identity())).resolves.toEqual({
      available: true,
      scope: 'provider',
      providerId: 'support-provider',
      kinds,
    });
    await expect(service.capability(undefined, noProvider())).resolves.toMatchObject({
      available: true,
      scope: 'platform',
    });
    await expect(service.capability('boboca', superAdmin())).resolves.toMatchObject({
      scope: 'provider',
      providerId: 'boboca',
    });
    await expect(service.capability('missing', superAdmin())).resolves.toMatchObject({
      available: false,
      reason: SUPPORT_REFUSAL.PROVIDER_UNKNOWN,
    });
    await expect(
      service.capability(undefined, { ...identity(), actingProviderId: 'elsewhere' }),
    ).resolves.toMatchObject({
      available: false,
      reason: SUPPORT_REFUSAL.PROVIDER_NOT_PERMITTED,
    });
    await expect(service.capability(undefined, { ...identity(), apiKey: 'k' })).resolves.toMatchObject({
      available: false,
      reason: SUPPORT_REFUSAL.IDENTITY_REQUIRED,
    });
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'false');
    await expect(service.capability(undefined, identity())).resolves.toEqual({
      available: false,
      reason: SUPPORT_REFUSAL.INTAKE_DISABLED,
      kinds,
    });
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
    vi.stubEnv('SUPPORT_DISPATCH_ENABLED', 'true');
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
      Array.from({ length: 5 }, () => store.submit(body, ctx.userId, providerTarget(ctx.actingProviderId))),
    );
    expect(new Set(rows.map((r) => r.reference)).size).toBe(1);
    await expect(
      store.submit({ ...body, description: 'changed' }, ctx.userId, providerTarget(ctx.actingProviderId)),
    ).rejects.toThrow('already used');
    await store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId));
    await store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId));
    await expect(
      store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId)),
    ).rejects.toMatchObject({
      status: 429,
    });
    for (let i = 0; i < 197; i++)
      await store.submit(parseReport(report()), randomUUID(), providerTarget(ctx.actingProviderId));
    await expect(
      store.submit(parseReport(report()), randomUUID(), providerTarget(ctx.actingProviderId)),
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  it('queues one owner email per new bug; retries keep the reference and require a verified super-admin', async () => {
    vi.stubEnv('SUPPORT_INBOX_OWNER_ID', 'inbox-owner');
    const ctx = identity();
    const body = parseReport(report());
    const row = await store.submit(body, ctx.userId, providerTarget(ctx.actingProviderId));
    await store.submit(body, ctx.userId, providerTarget(ctx.actingProviderId));
    const suggestion = await store.submit(
      { ...body, kind: 'suggestion', submissionKey: randomUUID() },
      ctx.userId,
      providerTarget(ctx.actingProviderId),
    );
    expect(suggestion.inbox_mail_state).toBe('none');
    const owner = {
      contactEmail: 'owner@example.test',
      roles: ['client'],
      emailVerifiedAt: undefined as Date | undefined,
    };
    const users = { findByUserId: vi.fn(async () => owner) };
    const transport = {
      notify: vi.fn(),
      notifyInbox: vi.fn().mockRejectedValueOnce(new Error('unconfirmed')).mockResolvedValue('receipt'),
    };
    const worker = () => new SupportWorker(store, transport as any, users as any).tick();
    const due = () => pool.query('UPDATE support_cases SET inbox_mail_after=now() WHERE reference=$1', [row.reference]);
    await worker();
    owner.roles = ['superadmin'];
    await due();
    await worker();
    expect(transport.notifyInbox).not.toHaveBeenCalled();
    owner.emailVerifiedAt = new Date();
    await due();
    await Promise.all([worker(), worker()]);
    expect(transport.notifyInbox).toHaveBeenCalledTimes(1);
    await due();
    await worker();
    expect(transport.notifyInbox.mock.calls).toEqual([
      [owner.contactEmail, row.reference],
      [owner.contactEmail, row.reference],
    ]);
    expect(users.findByUserId).toHaveBeenCalledWith('inbox-owner');
    expect((await store.get(row.reference)).inbox_mail_state).toBe('accepted');
  });

  it('projects only own receipt status and denies ordinary reads/resolution writes', async () => {
    const ctx = identity();
    const row = await store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId));
    const users = {
      findByUserId: vi.fn().mockResolvedValue({ contactEmail: 'operator@example.test', emailVerifiedAt: 'now' }),
    };
    const service = new SupportService(store, {} as any, {} as any, users as any, providers);
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

  it('dispatches an existing resolution while new submissions are disabled', async () => {
    const ctx = identity();
    const row = await store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId));
    await store.resolve(row.reference, 'Resolved', 'admin-test');
    vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'false');
    const users = {
      findByUserId: vi.fn().mockResolvedValue({ contactEmail: 'operator@example.test', emailVerifiedAt: 'verified' }),
    };
    const transport = { notify: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('accepted-id') };
    await new SupportWorker(store, transport as any, users as any).tick();
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect((await store.get(row.reference)).send_state).toBe('accepted');
  });

  it('waits for verified contact, persists the send lease before transport, retries the same key, then reports delivery unknown', async () => {
    const ctx = identity();
    const row = await store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId));
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
    const service = new SupportService(store, {} as any, {} as any, users as any, providers);
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
    const row = await store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId));
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
    const row = await store.submit(parseReport(report()), ctx.userId, providerTarget(ctx.actingProviderId));
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

  it('stores platform feedback without a provider and limits platform intake on its own', async () => {
    const rest = without(report(), 'expectedProvider');
    const row = await store.submit(parseReport(rest), randomUUID(), { scope: 'platform' });
    expect(row).toMatchObject({ scope: 'platform', provider_id: null, kind: 'bug' });
    // The schema refuses a platform case that names a provider, and a provider case that names none.
    await expect(
      pool.query(`UPDATE support_cases SET provider_id='support-provider' WHERE reference=$1`, [row.reference]),
    ).rejects.toThrow();
    await expect(
      pool.query(`UPDATE support_cases SET scope='provider' WHERE reference=$1`, [row.reference]),
    ).rejects.toThrow();
    for (let i = 0; i < 199; i++) await store.submit(parseReport(rest), randomUUID(), { scope: 'platform' });
    await expect(store.submit(parseReport(rest), randomUUID(), { scope: 'platform' })).rejects.toMatchObject({
      status: 429,
    });
    // Platform intake does not consume a provider's allowance.
    await expect(store.submit(parseReport(report()), randomUUID(), providerTarget())).resolves.toMatchObject({
      scope: 'provider',
    });
  });

  it('acknowledges a suggestion without queueing an email, and the inbox filters scope and kind', async () => {
    const minimal = without(evidence(), 'diagnostics', 'validation');
    const suggestion = await store.submit(
      parseReport({ ...report(), kind: 'suggestion', evidence: minimal }),
      randomUUID(),
      providerTarget(),
    );
    const bug = await store.submit(parseReport(report()), randomUUID(), providerTarget());
    await store.resolve(suggestion.reference, 'Triaged into a Mentat task', 'admin-test');
    expect((await store.get(suggestion.reference)).send_state).toBe('none');
    const users = { findByUserId: vi.fn().mockResolvedValue({ contactEmail: 'a@example.test', emailVerifiedAt: 'v' }) };
    const transport = { notify: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('id') };
    await new SupportWorker(store, transport as any, users as any).tick();
    expect(transport.send).not.toHaveBeenCalled();
    const suggestions = (await store.list(0, { kind: 'suggestion' })).reports;
    expect(suggestions.map((r) => r.reference)).toEqual([suggestion.reference]);
    expect((await store.list(0, { kind: 'bug', scope: 'provider' })).reports.map((r) => r.reference)).toEqual([
      bug.reference,
    ]);
    expect((await store.list(0, { scope: 'platform' })).reports).toHaveLength(0);
  });
});
