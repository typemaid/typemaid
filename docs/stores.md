# Stores

A store is where runs are saved. Pass one as `store` to `run()` and `resume()`.

| Store | Import | Use it for |
|---|---|---|
| Memory (default) | `memoryStore` from `typemaid` | Tests and workflows that finish in one go. Runs are lost when the process exits. |
| SQLite | `sqliteStore` from `typemaid/sqlite` | One server, or local development. Uses Node's built-in SQLite, so nothing extra is installed. |
| Postgres | `postgresStore` from `@typemaid/postgres` | Several servers sharing runs. |
| libSQL / Turso | `libsqlStore` from `@typemaid/libsql` | Turso, a libSQL server, or edge runtimes where SQLite files are not available. |
| Your own | three functions, below | Anything else. |

## SQLite

```ts
import { sqliteStore } from 'typemaid/sqlite';

const store = sqliteStore('./runs.db');
await run(flow, tools, input, { store });
store.close();
```

## Postgres

```bash
npm install @typemaid/postgres pg
```

```ts
import { Pool } from 'pg';
import { postgresStore } from '@typemaid/postgres';

const store = postgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));
await run(flow, tools, input, { store });
```

It accepts a `Pool` or `Client` from `pg`, and any client with the same `query(sql, params)` function (Neon, Vercel Postgres, PGlite). You own the connection; the store never opens or closes one.

## libSQL / Turso

```bash
npm install @typemaid/libsql @libsql/client
```

```ts
import { createClient } from '@libsql/client';
import { libsqlStore } from '@typemaid/libsql';

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const store = libsqlStore(client);
await run(flow, tools, input, { store });
```

## Options for the Postgres and libSQL stores

| Option | Default | Meaning |
|---|---|---|
| `table` | `flow_runs` | Table name. Postgres also accepts `schema.table`. |
| `createTable` | `true` | The table is created on first use. Set to `false` if you keep your own migrations; `postgresSchema()` and `libsqlSchema()` return the SQL. |

Both keep one row per run with the columns `tenant`, `run_id`, `version`, `status`, `flow_hash`, `flow`, `body`, `created_at` and `updated_at`. You can read them with plain SQL, for example to list paused runs:

```sql
SELECT run_id, updated_at FROM flow_runs WHERE tenant = 'default' AND status = 'paused';
```

Do not change rows by hand.

### How they are tested

Every store, including memory and SQLite, runs the same tests (`test/store-contract.ts`): exact save and load, tenants kept apart, a crash after every possible save followed by a resume, and several connections racing to save the same run.

- **Postgres:** on PGlite (Postgres inside the test process) on every test run, and on a real Postgres 14 server through the `pg` driver when `TYPEMAID_TEST_POSTGRES_URL` is set. Both were run and pass. Not run against Neon, Vercel Postgres or Supabase.
- **libSQL:** on local database files on every test run, and on a server when `TYPEMAID_TEST_LIBSQL_URL` is set. Only the local files were run. It has not been run against Turso or a libSQL server yet.

## Writing your own store

### The interface

```ts
interface Store {
  create(record: RunRecord): Promise<void>;
  load(tenant: string, runId: string): Promise<RunRecord | undefined>;
  save(record: RunRecord, expectedVersion: number): Promise<void>;
}
```

A `RunRecord` is plain JSON. Save it whole; you do not need to understand its inside.

The rules a store must follow:

1. **`create` fails if the run already exists.** Runs are identified by `tenant` and `runId` together.
2. **`save` replaces the run only if its stored version equals `expectedVersion`,** and throws `StaleRunError` otherwise. The check and the write must be one atomic step, which in SQL means one `UPDATE ... WHERE version = ?`. Reading the version first and writing afterwards is not safe.
3. **`load` returns exactly what was saved,** or `undefined`. Never return another tenant's run.

Rule 2 is what stops two workers from both continuing the same run.

### A starting point

The Postgres store is one short file and a good one to copy: [`packages/postgres/src/index.ts`](../packages/postgres/src/index.ts). The heart of it is these two statements:

```ts
async create(record) {
  const result = await db.query(
    'INSERT INTO flow_runs (tenant, run_id, version, status, body) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [record.tenant, record.runId, record.version, record.status, JSON.stringify(record)],
  );
  if (result.rowCount !== 1) throw new Error(`Run ${record.runId} already exists.`);
},
async save(record, expectedVersion) {
  // One statement: it changes the row only if nobody else has moved the run on.
  const result = await db.query(
    'UPDATE flow_runs SET version = $1, status = $2, body = $3 WHERE tenant = $4 AND run_id = $5 AND version = $6',
    [record.version, record.status, JSON.stringify(record), record.tenant, record.runId, expectedVersion],
  );
  if (result.rowCount !== 1) throw new StaleRunError(record.runId);
},
```

Import `StaleRunError` from `typemaid`, so it is the same class the runner checks for.

### Checking your own store

Inside this repository, call `storeContract('my store', () => myStore())` from `test/store-contract.ts` in a Bun test, as the Postgres and libSQL packages do. Elsewhere, at minimum test that:

- a run that pauses can be resumed through a second store object pointing at the same database;
- `save` with an old `expectedVersion` throws `StaleRunError`;
- `create` twice with the same run throws;
- `load` with another tenant returns `undefined`.

## Good to know (all stores)

- **The record grows with the shared data** (up to 5,000,000 characters of JSON by default) and is rewritten after every step. Keep large files out of it.
- **`auth` is never in the record.**
- **Old runs are not deleted for you.** Delete finished runs on your own schedule.
- **A store over an HTTP database also works on edge runtimes,** where the SQLite store does not.
