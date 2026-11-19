A store saves runs so they can pause, resume and survive restarts. Pass one as `store` to [`run()`](/docs/api/run/) and [`resume()`](/docs/api/resume/). For setup and trade-offs, see the [Stores guide](/docs/stores/).

## memoryStore()

```ts
import { memoryStore } from 'typemaid';

function memoryStore(options?: { maxRuns?: number }): Store;
```

Keeps runs in memory; they are lost when the process exits. With `maxRuns`, the oldest finished runs are dropped first; running and paused runs are never dropped. `run()` uses a shared memory store (with `maxRuns: 1000`) when you pass none.

## sqliteStore()

```ts
import { sqliteStore } from 'typemaid/sqlite';

function sqliteStore(path: string): Store & { close(): void };
```

Saves runs in a SQLite file using Node's built-in driver, so nothing extra is installed. Node and Bun only.

## postgresStore()

```ts
import { postgresStore, postgresSchema } from '@typemaid/postgres';

function postgresStore(db: PostgresClient, options?: {
  table?: string;          // default 'flow_runs'; may include a schema: 'app.runs'
  createTable?: boolean;   // default true
}): Store;

function postgresSchema(table?: string): string; // the CREATE TABLE statement
```

`db` is anything with `query(sql, params)`: a `pg` `Pool` or `Client`, Neon, Vercel Postgres or PGlite. Set `createTable: false` and run `postgresSchema()` in your own migrations if you manage the schema yourself.

## libsqlStore()

```ts
import { libsqlStore, libsqlSchema } from '@typemaid/libsql';

function libsqlStore(client: LibsqlClient, options?: {
  table?: string;          // default 'flow_runs'
  createTable?: boolean;   // default true
}): Store;

function libsqlSchema(table?: string): string;
```

`client` is a libSQL client with `execute({ sql, args })`, for Turso, a libSQL server, or edge runtimes.

## The Store interface

Write your own store by implementing three functions:

```ts
import type { RunRecord, Store } from 'typemaid';
import { StaleRunError } from 'typemaid';

interface Store {
  create(record: RunRecord): Promise<void>;
  load(tenant: string, runId: string): Promise<RunRecord | undefined>;
  /** Replace the stored run only if its stored version is `expectedVersion`. Must be atomic. */
  save(record: RunRecord, expectedVersion: number): Promise<void>;
}
```

`save` must throw `StaleRunError` when the stored version is not `expectedVersion`. That is what stops two processes from moving the same run on at once.
