import { PostgresParticipationStorage } from './postgres-participation.storage';

/** A pooled client whose behaviour per statement is scriptable. */
function makePool(onQuery: (sql: string) => any) {
  const client = {
    query: vi.fn(async (...args: [sql: string, values?: unknown[]]) => onQuery(args[0])),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() } as any;
  return { pool, client };
}

const row = (over: any = {}) => ({
  subjectType: 'TEAM' as const,
  subjectId: 'ita-A',
  tournamentId: 'dual-1',
  participantId: 'local-a',
  ...over,
});

describe('PostgresParticipationStorage.replaceTournamentRows', () => {
  it('deletes then inserts inside one transaction, and releases the client', async () => {
    const { pool, client } = makePool(() => ({ rows: [] }));
    await new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', [row()]);

    const statements = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(statements).toEqual(['BEGIN', 'DELETE', 'INSERT', 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
  });

  it('surfaces the ORIGINAL error when the connection dies, not the ROLLBACK rejection', async () => {
    // The failure mode this guard exists for, and it is a RACE rather than the routine case: an
    // INFORMATIVE failure, and then the connection dying before the rollback runs. (When the
    // connection dies first, the original is itself the connection error and masking costs
    // nothing — measured.) Here the constraint violation is the root cause and must survive.
    const original = new Error('duplicate key value violates unique constraint');
    const dead = new Error('Client has encountered a connection error and is not queryable');
    const { pool, client } = makePool((sql) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('DELETE')) return { rows: [] };
      if (sql.trim().startsWith('INSERT')) throw original;
      throw dead; // ROLLBACK on a dead client
    });

    await expect(new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', [row()])).rejects.toBe(original);
    expect(client.release).toHaveBeenCalled();
  });

  it('still rolls back, and still rethrows, on an ordinary failure', async () => {
    const original = new Error('constraint');
    const { pool, client } = makePool((sql) => {
      if (sql.trim().startsWith('INSERT')) throw original;
      return { rows: [] };
    });

    await expect(new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', [row()])).rejects.toBe(original);
    expect(client.query.mock.calls.map(([sql]) => String(sql).trim())).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('persists the issuing organisation, so two bodies numbering a competitor alike stay apart', async () => {
    // subjectId is unique only WITHIN its issuing body. Without this column a read for one id
    // returns every body's competitor carrying it, merged into one plausible longer history.
    const { pool, client } = makePool(() => ({ rows: [] }));
    await new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', [row({ organisationId: 'body-A' })]);

    const insert = client.query.mock.calls.find(([sql]) => String(sql).trim().startsWith('INSERT'));
    // Assert the INSERT happened before reading it: a `.find()` miss would otherwise fail on
    // `undefined[0]` and read as a broken test rather than a missing statement.
    expect(insert).toBeDefined();
    expect(String(insert?.[0])).toContain('organisation_id');
    expect(insert?.[1]).toContain('body-A');
  });

  it('narrows the read to one issuing body IN SQL, and returns everything when not given one', async () => {
    const pool: any = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() };
    const storage = new PostgresParticipationStorage(pool);

    await storage.listForSubject('TEAM', '12345', 'body-A');
    expect(pool.query.mock.calls[0][1]).toEqual(['TEAM', '12345', 'body-A']);

    // Absent issuer must pass NULL, not the string 'undefined', or the predicate matches nothing.
    await storage.listForSubject('TEAM', '12345');
    expect(pool.query.mock.calls[1][1]).toEqual(['TEAM', '12345', null]);
    // Filtering after the read would still have loaded every body's rows — the cost being avoided.
    expect(String(pool.query.mock.calls[0][0])).toContain('organisation_id = $3');
  });

  it('maps organisation_id back out, and leaves it undefined when the row does not record one', async () => {
    const withOrg: any = { query: vi.fn().mockResolvedValue({ rows: [
      { subject_type: 'TEAM', subject_id: 'A', tournament_id: 't', participant_id: 'p', organisation_id: 'body-A' },
      { subject_type: 'TEAM', subject_id: 'A', tournament_id: 'u', participant_id: 'p', organisation_id: null },
    ] }), connect: vi.fn() };
    const rows = await new PostgresParticipationStorage(withOrg).listForSubject('TEAM', 'A');
    expect(rows[0].organisationId).toBe('body-A');
    expect(rows[1].organisationId).toBeUndefined();
  });

  it('replaces with an EMPTY set, so a tournament losing its competitors loses its rows', async () => {
    const { pool, client } = makePool(() => ({ rows: [] }));
    await new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', []);
    const statements = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(statements).toEqual(['BEGIN', 'DELETE', 'COMMIT']);
  });
});
