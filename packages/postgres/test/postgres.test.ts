import { afterAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { human, run } from 'typemaid';
import { postgresSchema, postgresStore, type PostgresClient } from '@typemaid/postgres';
import { storeContract } from '../../../test/store-contract.ts';

let n = 0;

// Postgres running inside this process: always available, one connection.
const lite = new PGlite();
afterAll(() => lite.close());
storeContract('postgres store (PGlite)', () => postgresStore(lite, { table: `runs_${++n}` }), {
  pair: () => {
    const table = `runs_${++n}`;
    return [postgresStore(lite, { table }), postgresStore(lite, { table })];
  },
});

// A real server through the `pg` driver, when one is given.
const url = process.env.TYPEMAID_TEST_POSTGRES_URL;
const schema = `flow_test_${Date.now().toString(36)}`;
const pools: pg.Pool[] = [];
const pool = (): pg.Pool => {
  const p = new pg.Pool({ connectionString: url, max: 4 });
  pools.push(p);
  return p;
};
let shared: pg.Pool | undefined;
const server = async (): Promise<pg.Pool> => {
  if (!shared) {
    shared = pool();
    await shared.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  }
  return shared;
};
afterAll(async () => {
  if (shared) await shared.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await Promise.all(pools.map((p) => p.end()));
});
storeContract('postgres store (server, pg driver)', async () => postgresStore(await server(), { table: `${schema}.runs_${++n}` }), {
  skip: !url,
  pair: async () => {
    await server();
    const table = `${schema}.runs_${++n}`;
    // Separate pools, so the saves really arrive on different connections.
    return [postgresStore(pool(), { table }), postgresStore(pool(), { table }), postgresStore(pool(), { table })];
  },
});

describe.skipIf(!url)('postgres server', () => {
  it('stores started at the same moment all create the table without failing', async () => {
    await server();
    const table = `${schema}.runs_${++n}`;
    const stores = Array.from({ length: 8 }, () => postgresStore(pool(), { table }));
    const loaded = await Promise.all(stores.map((s) => s.load('default', 'nothing')));
    expect(loaded).toEqual(Array.from({ length: 8 }, () => undefined));
  });
});

describe('postgres store', () => {
  /** Counts what is sent, on top of the in-process database. */
  const spy = () => {
    const sent: string[] = [];
    const db: PostgresClient = { query: (sql, params) => (sent.push(sql), lite.query(sql, params as never[])) };
    return { db, sent };
  };

  it('uses the table called flow_runs unless told otherwise, and creates it once', async () => {
    const { db, sent } = spy();
    const store = postgresStore(db);
    const paused = await run('flowchart TD\n  ask', { ask: human() }, {}, { store });
    await store.load('default', paused.runId);
    expect(sent.filter((s) => s.startsWith('CREATE TABLE')).length).toBe(1);
    const rows = (await lite.query<{ run_id: string; status: string; version: number }>('SELECT run_id, status, version FROM flow_runs')).rows;
    expect(rows).toEqual([{ run_id: paused.runId, status: 'paused', version: expect.any(Number) }]);
  });

  it('keeps the columns up to date so runs can be found with plain SQL', async () => {
    const store = postgresStore(lite, { table: 'columns_check' });
    const t = { ask: human() };
    const paused = await run('flowchart TD\n  ask', t, {}, { store, tenant: 'acme' });
    const record = (await store.load('acme', paused.runId))!;
    await store.save({ ...record, status: 'completed', version: record.version + 1, updatedAt: '2030-01-02T03:04:05.000Z' }, record.version);
    const row = (await lite.query<Record<string, unknown>>('SELECT tenant, status, version, flow_hash, updated_at, created_at FROM columns_check')).rows[0]!;
    expect(row).toMatchObject({ tenant: 'acme', status: 'completed', version: record.version + 1, flow_hash: record.flow.hash });
    expect(new Date(row.updated_at as string).toISOString()).toBe('2030-01-02T03:04:05.000Z');
    expect(new Date(row.created_at as string).toISOString()).toBe(record.createdAt);
  });

  it('with createTable off it sends no CREATE TABLE, and postgresSchema() gives the SQL to run yourself', async () => {
    const { db, sent } = spy();
    const store = postgresStore(db, { table: 'own_migration', createTable: false });
    await expect(store.load('default', 'x')).rejects.toThrow();
    await lite.exec(postgresSchema('own_migration'));
    await lite.exec(postgresSchema('own_migration'));
    expect((await run('flowchart TD\n  ask', { ask: human() }, {}, { store })).status).toBe('paused');
    expect(sent.some((s) => s.startsWith('CREATE'))).toBe(false);
  });

  it('accepts schema.table and refuses names that are not plain identifiers', async () => {
    await lite.exec('CREATE SCHEMA app');
    const store = postgresStore(lite, { table: 'app.runs' });
    expect((await run('flowchart TD\n  ask', { ask: human() }, {}, { store })).status).toBe('paused');
    expect((await lite.query('SELECT 1 FROM app.runs')).rows.length).toBe(1);
    for (const bad of ['runs; DROP TABLE x', 'a.b.c', '"quoted"', '', 'has space', '1st']) {
      expect(() => postgresStore(lite, { table: bad }), bad).toThrow(/Table name/);
      expect(() => postgresSchema(bad), bad).toThrow(/Table name/);
    }
  });

  it('if the table cannot be created, the error is reported and the next call tries again', async () => {
    let down = true;
    const db: PostgresClient = { query: (sql, params) => (down ? Promise.reject(new Error('database is down')) : lite.query(sql, params as never[])) };
    const store = postgresStore(db, { table: 'retry_setup' });
    await expect(store.load('default', 'x')).rejects.toThrow('database is down');
    down = false;
    expect(await store.load('default', 'x')).toBeUndefined();
  });

  it('a Pool and a Client from pg fit without a wrapper', () => {
    // Checked by the type checker; nothing connects here.
    const fits = (make: () => PostgresClient) => typeof make;
    expect(fits(() => new pg.Pool())).toBe('function');
    expect(fits(() => new pg.Client())).toBe('function');
  });
});
