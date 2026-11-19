import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { createClient, type Client } from '@libsql/client';
import { human, run } from 'typemaid';
import { libsqlSchema, libsqlStore, type LibsqlClient } from '@typemaid/libsql';
import { storeContract } from '../../../test/store-contract.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'flow-libsql-'));
const clients: Client[] = [];
let n = 0;
const open = (config: Parameters<typeof createClient>[0]): Client => {
  const client = createClient(config);
  clients.push(client);
  return client;
};
const file = () => `file:${path.join(dir, `runs-${++n}.db`)}`;

// A local database file: always available.
storeContract('libsql store (local file)', () => libsqlStore(open({ url: file() })), {
  pair: () => {
    const url = file();
    return [libsqlStore(open({ url })), libsqlStore(open({ url }))];
  },
});

// A libSQL server or Turso over the network, when one is given.
const url = process.env.TYPEMAID_TEST_LIBSQL_URL;
const authToken = process.env.TYPEMAID_TEST_LIBSQL_TOKEN;
const prefix = `flow_test_${Date.now().toString(36)}`;
const tables: string[] = [];
const table = () => {
  const name = `${prefix}_${++n}`;
  tables.push(name);
  return name;
};
storeContract('libsql store (server)', () => libsqlStore(open({ url: url!, authToken }), { table: table() }), {
  skip: !url,
  pair: () => {
    const name = table();
    return [libsqlStore(open({ url: url!, authToken }), { table: name }), libsqlStore(open({ url: url!, authToken }), { table: name })];
  },
});

afterAll(async () => {
  if (url) {
    const admin = createClient({ url, authToken });
    for (const name of tables) await admin.execute(`DROP TABLE IF EXISTS "${name}"`);
    admin.close();
  }
  for (const client of clients) client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('libsql store', () => {
  const spy = (client: Client) => {
    const sent: string[] = [];
    const db: LibsqlClient = { execute: (statement) => (sent.push(statement.sql), client.execute(statement)) };
    return { db, sent };
  };

  it('uses the table called flow_runs unless told otherwise, and creates it once', async () => {
    const client = open({ url: file() });
    const { db, sent } = spy(client);
    const store = libsqlStore(db);
    const paused = await run('flowchart TD\n  ask', { ask: human() }, {}, { store });
    await store.load('default', paused.runId);
    expect(sent.filter((s) => s.startsWith('CREATE TABLE')).length).toBe(1);
    const rows = (await client.execute('SELECT run_id, status FROM flow_runs')).rows;
    expect(rows.map((r) => ({ ...r }) as Record<string, unknown>)).toEqual([{ run_id: paused.runId, status: 'paused' }]);
  });

  it('keeps the columns up to date so runs can be found with plain SQL', async () => {
    const client = open({ url: file() });
    const store = libsqlStore(client);
    const paused = await run('flowchart TD\n  ask', { ask: human() }, {}, { store, tenant: 'acme' });
    const record = (await store.load('acme', paused.runId))!;
    await store.save({ ...record, status: 'completed', version: record.version + 1, updatedAt: '2030-01-02T03:04:05.000Z' }, record.version);
    const row = (await client.execute('SELECT tenant, status, version, flow_hash, created_at, updated_at FROM flow_runs')).rows[0]!;
    expect({ ...row } as Record<string, unknown>).toEqual({ tenant: 'acme', status: 'completed', version: record.version + 1, flow_hash: record.flow.hash, created_at: record.createdAt, updated_at: '2030-01-02T03:04:05.000Z' });
  });

  it('a paused run is still there after the client is closed and the file is opened again', async () => {
    const url = file();
    const first = createClient({ url });
    const paused = await run('flowchart TD\n  ask', { ask: human() }, {}, { store: libsqlStore(first) });
    first.close();
    expect((await libsqlStore(open({ url })).load('default', paused.runId))!.status).toBe('paused');
  });

  it('with createTable off it sends no CREATE TABLE, and libsqlSchema() gives the SQL to run yourself', async () => {
    const client = open({ url: file() });
    const { db, sent } = spy(client);
    const store = libsqlStore(db, { table: 'own_migration', createTable: false });
    await expect(store.load('default', 'x')).rejects.toThrow();
    await client.execute(libsqlSchema('own_migration'));
    await client.execute(libsqlSchema('own_migration'));
    expect((await run('flowchart TD\n  ask', { ask: human() }, {}, { store })).status).toBe('paused');
    expect(sent.some((s) => s.startsWith('CREATE'))).toBe(false);
  });

  it('refuses table names that are not plain identifiers', () => {
    const client = open({ url: file() });
    for (const bad of ['runs; DROP TABLE x', 'a.b', '"quoted"', '', 'has space', '1st']) {
      expect(() => libsqlStore(client, { table: bad }), bad).toThrow(/Table name/);
      expect(() => libsqlSchema(bad), bad).toThrow(/Table name/);
    }
  });

  it('if the table cannot be created, the error is reported and the next call tries again', async () => {
    const client = open({ url: file() });
    let down = true;
    const db: LibsqlClient = { execute: (statement) => (down ? Promise.reject(new Error('database is down')) : client.execute(statement)) };
    const store = libsqlStore(db);
    await expect(store.load('default', 'x')).rejects.toThrow('database is down');
    down = false;
    expect(await store.load('default', 'x')).toBeUndefined();
  });
});
