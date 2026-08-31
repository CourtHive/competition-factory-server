import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { attachPoolErrorHandler } from './pool-error-handler';

// The controls come first deliberately. Without them these tests assert only that
// nothing threw, which is what a no-op would also do.
describe('attachPoolErrorHandler', () => {
  let logged: string[];
  let spy: any;

  beforeEach(() => {
    logged = [];
    spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((message: any) => {
      logged.push(String(message));
    });
  });

  afterEach(() => spy.mockRestore());

  it('CONTROL: an emitter with no error listener throws — this is what kills the process', () => {
    const bare = new EventEmitter();
    expect(() => bare.emit('error', new Error('terminating connection due to administrator command'))).toThrow(
      'terminating connection due to administrator command',
    );
  });

  it('survives an error on the POOL — the idle-client case', () => {
    const pool = new EventEmitter() as unknown as Pool;
    attachPoolErrorHandler(pool, 'core-db');
    expect(() => (pool as unknown as EventEmitter).emit('error', new Error('idle boom'))).not.toThrow();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('idle client error on the "core-db" pool');
    expect(logged[0]).toContain('idle boom');
  });

  // The case a pool-only listener misses. pg emits on the Client, not the pool,
  // for a connection checked out via pool.connect() — verified against a real
  // Postgres by killing the backend of a client held across a BEGIN.
  it('survives an error on a CHECKED-OUT client, which the pool listener does not cover', () => {
    const pool = new EventEmitter() as unknown as Pool;
    attachPoolErrorHandler(pool, 'core-db');

    const client = new EventEmitter();
    (pool as unknown as EventEmitter).emit('connect', client);

    expect(() => client.emit('error', new Error('checked-out boom'))).not.toThrow();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('connection error on the "core-db" pool');
    expect(logged[0]).toContain('checked-out boom');
  });

  it('CONTROL: a client that never went through the connect hook is still unguarded', () => {
    const pool = new EventEmitter() as unknown as Pool;
    attachPoolErrorHandler(pool, 'core-db');
    const stray = new EventEmitter(); // never emitted via 'connect'
    expect(() => stray.emit('error', new Error('boom'))).toThrow();
  });

  // The client listener is attached at connect time and cannot know whether the
  // client is checked out or idle when it fails. An earlier draft labelled it
  // "checked-out" and was caught printing that for an idle-client kill against a
  // real Postgres, so it now states only what is certainly true and hedges the
  // transaction claim. This test exists to keep that hedge.
  it('does not claim a state the client listener cannot know', () => {
    const pool = new EventEmitter() as unknown as Pool;
    attachPoolErrorHandler(pool, 'core-db');
    const client = new EventEmitter();
    (pool as unknown as EventEmitter).emit('connect', client);

    client.emit('error', new Error('a'));
    (pool as unknown as EventEmitter).emit('error', new Error('b'));

    expect(logged[0]).not.toContain('checked-out');
    expect(logged[0]).not.toContain('idle');
    expect(logged[0]).toContain('If a transaction was in flight');
    expect(logged[1]).toContain('idle client error');
    expect(logged[1]).toContain('The client was discarded');
  });

  it('guards every client the pool opens, not just the first', () => {
    const pool = new EventEmitter() as unknown as Pool;
    attachPoolErrorHandler(pool, 'core-db');
    const clients = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
    for (const c of clients) (pool as unknown as EventEmitter).emit('connect', c);
    for (const c of clients) expect(() => c.emit('error', new Error('boom'))).not.toThrow();
    expect(logged).toHaveLength(3);
  });

  it('returns the pool so it can wrap a factory expression', () => {
    const pool = new EventEmitter() as unknown as Pool;
    expect(attachPoolErrorHandler(pool, 'test')).toBe(pool);
  });

  it('does not disturb listeners already on the pool', () => {
    const pool = new EventEmitter() as unknown as Pool;
    const seen: Error[] = [];
    (pool as unknown as EventEmitter).on('error', (err: Error) => seen.push(err));
    attachPoolErrorHandler(pool, 'test');
    const boom = new Error('boom');
    (pool as unknown as EventEmitter).emit('error', boom);
    expect(seen).toEqual([boom]);
  });
});
